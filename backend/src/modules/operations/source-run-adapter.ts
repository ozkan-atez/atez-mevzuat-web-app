import { resourceOwnership, canonicalDocumentKey } from '../../platform/actor-context'
import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { OperationError, type OperationService } from './operation-service'

/** Adopt only archived input from the selected run. No discovery, downloading, publishing or delivery. */
export async function analyzeArchivedSourceRun(prisma:PrismaClient,service:OperationService,runId:string,key:string,mode:'FILL_MISSING'|'FORCE'='FILL_MISSING') {
 if(!key || key.length>150)throw new OperationError('Idempotency-Key gereklidir.',400)
 const run=await prisma.sourceScanRun.findUnique({where:{id:runId},include:{documents:{orderBy:{id:'asc'}}}})
 if(!run)throw new OperationError('Kaynak çalışması bulunamadı.',404)
 if(['QUEUED','RUNNING'].includes(run.status))throw new OperationError('Kaynak çalışması henüz tamamlanmadı.',409)
 const candidates=run.documents.filter(d=>d.filterDecision!=='OUT' && (d.contentText?.trim() || Array.isArray(d.capturedFiles)))
 if(!candidates.length)throw new OperationError('Analiz için arşivlenmiş belge veya metin bulunamadı.')
 const prepared:Array<{sourceDocumentId:string;versionIds:string[]}>=[],missing:Array<{sourceDocumentId:string;reason:string}>=[]
 for(const row of candidates) {
  const versions=await prisma.$transaction(async tx=>{
   const lock=createHash('sha256').update(`${service.scope}:${row.url}`).digest().readBigInt64BE();await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lock})`
   const existing=await tx.document.findUnique({where:{canonicalKey:canonicalDocumentKey(row.url,service.scope)}})
   if(existing && (existing.actorScope!==service.scope || existing.sourceId!==run.sourceId))throw new OperationError('Belge mevcut erişim kapsamına ait değil.',404)
   const document=existing ?? await tx.document.create({data:{...resourceOwnership(),canonicalKey:canonicalDocumentKey(row.url,service.scope),sourceId:run.sourceId,actorScope:service.scope,origin:'SOURCE',canonicalUrl:row.url,title:row.title,publishedOn:row.publishedOn}})
   const files=Array.isArray(row.capturedFiles)?row.capturedFiles:[]
   const main=files.find(f=>f && typeof f==='object' && !Array.isArray(f) && f.url===row.url && f.status==='STORED') as Record<string,unknown>|undefined
   const stored=main && typeof main.sha256==='string' ? await tx.storedObject.findUnique({where:{sha256:main.sha256}}):null
   if(stored && (stored.objectKey!==main?.objectKey || stored.bucket!==main?.bucket))throw new OperationError('Belge depolama kanıtı tutarsız.')
   // Recorded text is a distinct immutable source version; it is never labelled as PDF byte extraction.
   const text=row.contentText?.trim() || null
   if(!text && !stored)return []
   const hash=text?createHash('sha256').update(text).digest('hex'):stored!.sha256
   const version=await tx.documentVersion.upsert({where:{documentId_contentHash:{documentId:document.id,contentHash:hash}},create:{documentId:document.id,contentHash:hash,mimeType:text?'text/plain':stored!.mediaType,storedObjectId:text?null:stored!.id,extractedText:text,extractionStatus:text?'READY':'PENDING',fetchedAt:null,extractionMetadata:{legacySourceRun:true,contentBasis:text?'RECORDED_TEXT':'ARCHIVED_BYTES',sourceRunId:runId,sourceDocumentId:row.id}},update:{}})
   const link={actorScope:service.scope,documentVersionId:version.id,sourceRunId:runId,role:'SOURCE'}
   if(!await tx.documentLink.findFirst({where:link}))await tx.documentLink.create({data:link})
   return [version.id]
  })
  if(versions.length)prepared.push({sourceDocumentId:row.id,versionIds:versions});else missing.push({sourceDocumentId:row.id,reason:'ARCHIVED_INPUT_MISSING'})
 }
 if(!prepared.length)throw new OperationError('Arşivlenen girdiler eksik; belge alma adımını ayrıca çalıştırın.')
 const operationRequestIds:string[]=[]
 for(const p of prepared) {
  const request=await service.start({operation:'ANALYZE',mode,sourceRunId:runId,documentVersionIds:p.versionIds},`source-analyze:${createHash('sha256').update(`${runId}:${key}:${p.sourceDocumentId}`).digest('hex')}`)
  operationRequestIds.push(request.id)
 }
 return {runId,status:'QUEUED',operationRequestIds,missing}
}
