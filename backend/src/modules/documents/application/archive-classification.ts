import type { PrismaClient } from '@prisma/client'
import { documentAccessWhere } from '../../../platform/actor-context'

type RecordRow = {id:string;canonicalUrl:string|null;versions:Array<{id:string;storedObjectId:string|null;contentHash:string}>}
type Decision = {decision:string;at:Date}
/** Resolve only explicit decisions tied to an accessible immutable version and its recorded run. */
export async function archiveClassifications(prisma:PrismaClient, rows:RecordRow[], scope:string) {
  const result=new Map<string,Decision>()
  if(!rows.length)return result
  const ids=rows.flatMap(row=>row.versions.map(v=>v.id))
  const links=await prisma.documentLink.findMany({where:{...documentAccessWhere(scope),documentVersionId:{in:ids},role:'SOURCE'}})
  const scanIds=[...new Set(links.flatMap(l=>l.scanRunId?[l.scanRunId]:[]))]
  const sourceIds=[...new Set(links.flatMap(l=>l.sourceRunId?[l.sourceRunId]:[]))]
  const [collected,sources,artifacts]=await Promise.all([
    scanIds.length?prisma.collectedDocument.findMany({where:{edition:{scanRunId:{in:scanIds}}},include:{edition:true,filterDecisions:{orderBy:{updatedAt:'desc'},take:1}}}):[],
    sourceIds.length?prisma.sourceScanDocument.findMany({where:{runId:{in:sourceIds}}}):[],
    prisma.operationArtifact.findMany({where:{kind:'FILTER_RESULT',task:{...documentAccessWhere(scope),status:'SUCCEEDED',operation:'FILTER'}},orderBy:{createdAt:'desc'},select:{data:true,createdAt:true}}),
  ])
  const assign=(id:string,decision:string|null,at:Date)=>{if(decision && ['IN','OUT','MAYBE'].includes(decision) && (!result.has(id)||result.get(id)!.at<at))result.set(id,{decision,at})}
  for(const row of rows){
    const version=row.versions[0];if(!version)continue
    for(const link of links.filter(l=>l.documentVersionId===version.id)){
      for(const item of collected){
        if(item.edition.scanRunId!==link.scanRunId || item.sourceUrl!==row.canonicalUrl || !version.storedObjectId || item.storedObjectId!==version.storedObjectId)continue
        const d=item.filterDecisions[0];if(d)assign(row.id,d.finalDecision ?? (d.titleDecision==='MAYBE'?'MAYBE':null),d.updatedAt)
      }
      for(const item of sources){
        if(item.runId!==link.sourceRunId||item.url!==row.canonicalUrl||item.contentHash!==version.contentHash)continue
        assign(row.id,item.filterDecision,item.createdAt)
      }
    }
    for(const artifact of artifacts){
      const data=artifact.data as {decisions?:Array<{documentVersionId?:string;decision?:string}>}|null
      if(!Array.isArray(data?.decisions))continue
      const decision=data.decisions.find(d=>d.documentVersionId===version.id)
      if(decision?.decision)assign(row.id,decision.decision,artifact.createdAt)
    }
  }
  return result
}
