import { getActorContext, privateActorScope, resourceOwnership, canonicalDocumentKey } from '../../../platform/actor-context'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PrismaClient } from '@prisma/client'
import type { ObjectStore } from '../../scan-runs/application/ports'
import { DocumentError, validateDocumentContent } from '../domain/document-content'
import { extractDocumentVersion } from './extract-document'

export interface DocumentStore extends Pick<ObjectStore, 'getContent'> { putContent?: ObjectStore['putContent']; putRunFile?: ObjectStore['putRunFile'] }
export interface DocumentDependencies { prisma: PrismaClient; objectStore: DocumentStore; actorScope?: string }
export interface ImportDocumentInput { bytes: Buffer; filename: string; mediaType?: string; title?: string | undefined; publishedOn?: string | undefined; documentId?: string | undefined; origin?: 'UPLOAD' | 'USER_TEXT'; canonicalUrl?: string; actorScope: string; idempotencyKey?: string; allowHtml?: boolean; tempPath?: string }
export function publicVersion(version: {id:string;mimeType:string;extractionStatus:string;originalFilename:string|null;createdAt:Date}) {
  return {id:version.id,mimeType:version.mimeType,extractionStatus:version.extractionStatus,originalFilename:version.originalFilename,createdAt:version.createdAt}
}
export async function importDocument(dependencies: DocumentDependencies, input: ImportDocumentInput) {
  if(getActorContext())input={...input,actorScope:privateActorScope()}
  const { prisma, objectStore } = dependencies
  const mediaType = await validateDocumentContent(input.bytes, input.filename, input.mediaType, input.allowHtml)
  const sha256 = createHash('sha256').update(input.bytes).digest('hex')
  const title = input.title?.trim() || input.filename
  const payloadHash = createHash('sha256').update(JSON.stringify({sha256,title,documentId:input.documentId ?? null,publishedOn:input.publishedOn ?? null,url:input.canonicalUrl ?? null,origin:input.origin ?? 'UPLOAD'})).digest('hex')
  const idempotencyKey = input.idempotencyKey || randomUUID()
  const existing = await prisma.documentImport.findUnique({where: {actorScope_idempotencyKey: {actorScope: input.actorScope, idempotencyKey}}, include: {documentVersion: {include: {document: true}}}})
  let pending: {id: string}
  if (existing) {
    if (existing.payloadHash !== payloadHash) throw new DocumentError('Aynı istek anahtarı farklı bir belge için kullanıldı.',409)
    if (existing.documentVersion) return {document: existing.documentVersion.document, version: publicVersion(existing.documentVersion), import: {id:existing.id,status:existing.status,error:existing.error}}
    const stale = existing.updatedAt.getTime() < Date.now() - 15 * 60_000
    if (existing.status !== 'FAILED' && !stale) throw new DocumentError('Belge ekleme işlemi devam ediyor; aynı anahtarla tekrar deneyin.',409)
    const recovered = await prisma.documentImport.updateMany({where:{id:existing.id,status:existing.status,updatedAt:existing.updatedAt},data:{status:'PENDING',error:null}})
    if (recovered.count !== 1) throw new DocumentError('Belge ekleme işlemi başka bir istekte devam ediyor.',409)
    pending = existing
  } else {
    if (input.documentId && !await prisma.document.findFirst({where: {id:input.documentId,actorScope: input.actorScope}})) throw new DocumentError('Belge bulunamadı.',404)
    pending = await prisma.documentImport.create({data: {...resourceOwnership(),actorScope:input.actorScope,idempotencyKey,payloadHash,status:'PENDING'}}).catch(error => {
      if ((error as {code?:string}).code === 'P2002') throw new DocumentError('Belge ekleme işlemi aynı anahtarla devam ediyor.',409)
      throw error
    })
  }
  let temporary: string | undefined
  try {
    let stored = await prisma.storedObject.findUnique({where: {sha256}})
    if (!stored) {
      let blob
      if (objectStore.putContent) {
        let path = input.tempPath
        if (!path) { temporary = await mkdtemp(join(tmpdir(),'atez-import-')); path = join(temporary,'file'); await writeFile(path,input.bytes,{mode:0o600}) }
        blob = await objectStore.putContent({sourceUrl:input.canonicalUrl ?? '',tempPath:path,sha256,mediaType,byteSize:BigInt(input.bytes.length)})
      } else if (objectStore.putRunFile) {
        blob = await objectStore.putRunFile(`objects/sha256/${sha256.slice(0,2)}/${sha256}`, input.bytes, mediaType)
      } else throw new DocumentError('Belge deposu yapılandırılmamış.',503)
      stored = await prisma.storedObject.upsert({where:{sha256},create:{sha256,bucket:blob.bucket,objectKey:blob.objectKey,mediaType,byteSize:blob.byteSize,...(blob.versionId ? {versionId:blob.versionId}:{})},update:{}})
    }
    const version = await prisma.$transaction(async tx => {
      const lockHash = createHash('sha256').update(`${input.actorScope}:${input.documentId ?? sha256}`).digest().readBigInt64BE()
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockHash})`
      // Reuse only a logical document in the caller's access scope; hashes do not confer access.
      let document = input.documentId ? await tx.document.findFirst({where:{id:input.documentId,actorScope:input.actorScope}}) : await tx.document.findFirst({where:{actorScope:input.actorScope,origin:input.origin ?? 'UPLOAD',...(input.canonicalUrl ? {canonicalUrl:input.canonicalUrl}:{canonicalUrl:null,versions:{some:{contentHash:sha256}}})}})
      if (input.documentId && !document) throw new DocumentError('Belge bulunamadı.',404)
      if (!document) document = await tx.document.create({data:{...resourceOwnership(),canonicalKey:input.canonicalUrl ? canonicalDocumentKey(input.canonicalUrl,input.actorScope):null,title,origin:input.origin ?? 'UPLOAD',actorScope:input.actorScope,canonicalUrl:input.canonicalUrl ?? null,publishedOn:input.publishedOn ? new Date(`${input.publishedOn}T00:00:00Z`):null}})
      const version = await tx.documentVersion.upsert({where:{documentId_contentHash:{documentId:document.id,contentHash:sha256}},create:{documentId:document.id,contentHash:sha256,storedObjectId:stored!.id,mimeType:mediaType,originalFilename:input.filename,extractionStatus:'PENDING'},update:{}})
      await tx.documentImport.update({where:{id:pending.id},data:{documentVersionId:version.id,status:'STORED'}})
      return {...version,document}
    })
    if (version.extractionStatus === 'PENDING' || version.extractionStatus === 'FAILED') await extractDocumentVersion({prisma,objectStore},version.id,input.actorScope)
    const refreshed = await prisma.documentVersion.findUniqueOrThrow({where:{id:version.id}})
    const completed = await prisma.documentImport.update({where:{id:pending.id},data:{status:refreshed.extractionStatus === 'FAILED' ? 'FAILED' : refreshed.extractionStatus === 'OCR_REQUIRED' ? 'OCR_REQUIRED' : 'READY',error:refreshed.extractionStatus === 'FAILED' ? 'Metin çıkarılamadı; özgün belge arşivde saklandı.':null}})
    return {document:version.document,version:publicVersion(refreshed),import:{id:completed.id,status:completed.status,error:completed.error}}
  } catch (error) {
    await prisma.documentImport.update({where:{id:pending.id},data:{status:'FAILED',error:error instanceof DocumentError ? error.message:'Belge kaydedilemedi.'}})
    if ((error as {code?:string}).code === 'P2002') throw new DocumentError('Belge kaydı çakıştı; yeniden deneyin.',409)
    throw error
  } finally { if (temporary) await rm(temporary,{recursive:true,force:true}) }
}
