import { canonicalDocumentKey } from '../../../platform/actor-context'
import { createHash } from 'node:crypto'
import type { PrismaClient, Prisma } from '@prisma/client'

export interface BackfillOptions { apply?: boolean; actorScope?: string; pageSize?: number }
export interface BackfillSummary { mode:'DRY_RUN'|'APPLY'; collectedDocuments:number; sourceDocuments:number; mappedVersions:number; missingBytes:number; scopeConflicts:number; missingSource:number }
interface Candidate { url:string; title:string; sourceId:string; publishedOn:Date|null; storedObjectId?:string; contentHash:string; mimeType:string; text?:string; scanRunId?:string; sourceRunId?:string }
/** Additive mapping only. Does not download files, extract content, or invent provenance. */
export async function backfillDocumentArchive(prisma:PrismaClient,options:BackfillOptions={}) {
  const actorScope=options.actorScope ?? 'local-workspace'
  const pageSize=Math.max(1,Math.min(options.pageSize ?? 100,500))
  const summary:BackfillSummary={mode:options.apply?'APPLY':'DRY_RUN',collectedDocuments:0,sourceDocuments:0,mappedVersions:0,missingBytes:0,scopeConflicts:0,missingSource:0}
  const map=async(candidate:Candidate)=>{
    const existing=await prisma.document.findUnique({where:{canonicalKey:canonicalDocumentKey(candidate.url,actorScope)}})
    if(existing && (existing.actorScope!==actorScope || existing.sourceId!==candidate.sourceId)){summary.scopeConflicts++;return}
    summary.mappedVersions++
    if(!options.apply)return
    await prisma.$transaction(async tx=>{
      const lock=createHash('sha256').update(`${actorScope}:${candidate.url}`).digest().readBigInt64BE()
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lock})`
      const document=await tx.document.upsert({where:{canonicalKey:canonicalDocumentKey(candidate.url,actorScope)},create:{canonicalKey:canonicalDocumentKey(candidate.url,actorScope),sourceId:candidate.sourceId,actorScope,origin:'SOURCE',canonicalUrl:candidate.url,title:candidate.title,publishedOn:candidate.publishedOn},update:{}})
      if(document.actorScope!==actorScope || document.sourceId!==candidate.sourceId){summary.scopeConflicts++;return}
      const version=await tx.documentVersion.upsert({where:{documentId_contentHash:{documentId:document.id,contentHash:candidate.contentHash}},create:{documentId:document.id,contentHash:candidate.contentHash,mimeType:candidate.mimeType,storedObjectId:candidate.storedObjectId ?? null,extractedText:candidate.text ?? null,extractionStatus:candidate.text?.trim()?'READY':'PENDING',fetchedAt:null,extractionMetadata:{legacyBackfill:true,contentBasis:candidate.storedObjectId?'ARCHIVED_BYTES':'RECORDED_TEXT'}},update:{}})
      if(candidate.storedObjectId && !version.storedObjectId) await tx.documentVersion.update({where:{id:version.id},data:{storedObjectId:candidate.storedObjectId}})
      const linkage={actorScope,documentVersionId:version.id,scanRunId:candidate.scanRunId ?? null,sourceRunId:candidate.sourceRunId ?? null,role:'SOURCE'}
      if(!await tx.documentLink.findFirst({where:linkage}))await tx.documentLink.create({data:linkage})
    })
  }
  let cursor:string|undefined
  for(;;){
    const rows: Array<Prisma.CollectedDocumentGetPayload<{include:{storedObject:true,edition:{include:{scanRun:true}}}}>>=await prisma.collectedDocument.findMany({take:pageSize,orderBy:{id:'asc'},...(cursor?{cursor:{id:cursor},skip:1}:{}),include:{storedObject:true,edition:{include:{scanRun:true}}}})
    if(!rows.length)break
    for(const row of rows){
      summary.collectedDocuments++
      if(!row.storedObject){summary.missingBytes++;continue}
      const source=row.externalSourceDocumentId ? await prisma.sourceScanDocument.findUnique({where:{id:row.externalSourceDocumentId},include:{run:true}}) : null
      const sourceId=source?.run.sourceId ?? (await prisma.source.findUnique({where:{key:'resmi-gazete'},select:{id:true}}))?.id
      if(!sourceId){summary.missingSource++;continue}
      await map({url:row.sourceUrl,title:row.title,sourceId,publishedOn:source ? source.publishedOn:row.edition.publicationDate,storedObjectId:row.storedObject.id,contentHash:row.storedObject.sha256,mimeType:row.storedObject.mediaType,scanRunId:row.edition.scanRunId,...(source?{sourceRunId:source.runId}:{})})
    }
    cursor=rows.at(-1)!.id
  }
  cursor=undefined
  for(;;){
    const rows: Array<Prisma.SourceScanDocumentGetPayload<{include:{run:true}}>>=await prisma.sourceScanDocument.findMany({take:pageSize,orderBy:{id:'asc'},...(cursor?{cursor:{id:cursor},skip:1}:{}),include:{run:true}})
    if(!rows.length)break
    for(const row of rows){
      summary.sourceDocuments++
      const files=Array.isArray(row.capturedFiles)?row.capturedFiles:[]
      let mainMapped=false
      for(const value of files){
        if(!value||typeof value!=='object'||Array.isArray(value))continue
        const file=value as Record<string,Prisma.JsonValue>
        if(file.status!=='STORED'||typeof file.sha256!=='string'||typeof file.url!=='string')continue
        const stored=await prisma.storedObject.findUnique({where:{sha256:file.sha256}})
        if(!stored || stored.objectKey!==file.objectKey || stored.bucket!==file.bucket){summary.missingBytes++;continue}
        await map({url:file.url,title:typeof file.title==='string'?file.title:row.title,sourceId:row.run.sourceId,publishedOn:file.role==='DOCUMENT'?row.publishedOn:null,storedObjectId:stored.id,contentHash:stored.sha256,mimeType:stored.mediaType,sourceRunId:row.runId,...(row.run.scanRunId?{scanRunId:row.run.scanRunId}:{})})
        if(file.url===row.url)mainMapped=true
      }
      if(!mainMapped && row.contentText?.trim()){
        const hash=createHash('sha256').update(row.contentText,'utf8').digest('hex')
        await map({url:row.url,title:row.title,sourceId:row.run.sourceId,publishedOn:row.publishedOn,contentHash:hash,mimeType:'text/plain',text:row.contentText,sourceRunId:row.runId,...(row.run.scanRunId?{scanRunId:row.run.scanRunId}:{})})
        summary.missingBytes++
      } else if(!mainMapped)summary.missingBytes++
    }
    cursor=rows.at(-1)!.id
  }
  return summary
}
