import {assignMetadataPreservingActivity,type LegacyActivityModel} from '../src/modules/documents/application/preserve-legacy-activity'
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { canonicalDocumentKey } from '../src/platform/actor-context'

async function main(){
 const args=process.argv.slice(2),apply=args.includes('--apply')
 const value=(name:string)=>{const at=args.indexOf(name);return at<0?undefined:args[at+1]}
 const workspaceId=value('--workspace-id'),ownerUserId=value('--owner-user-id')
 if(!workspaceId||!ownerUserId)throw new Error('Explicit workspace and owner IDs are required.')
 const prisma=new PrismaClient()
 try {
  const [workspace,membership,identity]=await Promise.all([prisma.workspace.findFirst({where:{id:workspaceId,key:'atez'}}),prisma.workspaceMembership.findFirst({where:{workspaceId,userId:ownerUserId,role:'ADMIN',active:true,user:{isActive:true}}}),prisma.externalIdentity.findFirst({where:{userId:ownerUserId}})])
  if(!workspace||!membership||!identity)throw new Error('Explicit provisioned ATEZ administrator required.')
  const sharedReportIds=args.flatMap((arg,i)=>arg==='--shared-report-id' && args[i+1]?[args[i+1]!]:[])
  const privateScope=`workspace:${workspaceId}:user:${ownerUserId}`,sharedScope=`workspace:${workspaceId}:shared`
  const summary={mode:apply?'APPLY':'DRY_RUN',documents:0,sharedOfficialDocuments:0,privateDocuments:0,chats:await prisma.chatSession.count({where:{visibility:'LEGACY'}}),operations:await prisma.operationRequest.count({where:{visibility:'LEGACY'}})}
  let cursor:string|undefined
  for(;;){
   const rows:Awaited<ReturnType<typeof prisma.document.findMany>>=await prisma.document.findMany({where:{visibility:'LEGACY',...(cursor?{id:{gt:cursor}}:{})},orderBy:{id:'asc'},take:100})
   if(!rows.length)break
   for(const doc of rows){
    summary.documents++
    const source=doc.sourceId?await prisma.source.findUnique({where:{id:doc.sourceId}}):null
    let official=false
    try{official=doc.origin==='SOURCE'&&source?.key==='resmi-gazete'&&!!doc.canonicalUrl&&/(^|\.)resmigazete\.gov\.tr$/.test(new URL(doc.canonicalUrl).hostname)}catch{}
    official?summary.sharedOfficialDocuments++:summary.privateDocuments++
    if(apply)await prisma.document.update({where:{id:doc.id},data:{workspaceId,ownerUserId:official?null:ownerUserId,visibility:official?'WORKSPACE':'PRIVATE',actorScope:official?sharedScope:privateScope,canonicalKey:doc.canonicalUrl?canonicalDocumentKey(doc.canonicalUrl,official?sharedScope:privateScope):null}})
   }
   cursor=rows.at(-1)!.id
  }
  if(apply)await prisma.$transaction(async tx=>{
   await assignMetadataPreservingActivity(tx.chatSession as unknown as LegacyActivityModel,{visibility:'LEGACY'},{workspaceId,ownerId:ownerUserId,visibility:'PRIVATE'})
   const privateData={workspaceId,ownerUserId,visibility:'PRIVATE',actorScope:privateScope}
   await assignMetadataPreservingActivity(tx.documentImport as unknown as LegacyActivityModel,{visibility:'LEGACY'},privateData)
   await tx.documentLink.updateMany({where:{visibility:'LEGACY'},data:privateData})
   await assignMetadataPreservingActivity(tx.operationRequest as unknown as LegacyActivityModel,{visibility:'LEGACY'},privateData)
   await assignMetadataPreservingActivity(tx.operationTask as unknown as LegacyActivityModel,{visibility:'LEGACY'},privateData)
   await tx.sourceCoverage.updateMany({where:{visibility:'LEGACY'},data:privateData})
   // Publication alone does not prove an old report has no private instructions/attachments.
   // Only explicitly reviewed report IDs may enter the shared corpus; all others remain private.
   await assignMetadataPreservingActivity(tx.topicReport as unknown as LegacyActivityModel,{visibility:'LEGACY',id:{in:sharedReportIds}},{workspaceId,ownerUserId:null,visibility:'WORKSPACE',actorScope:sharedScope})
   await assignMetadataPreservingActivity(tx.topicReport as unknown as LegacyActivityModel,{visibility:'LEGACY'},privateData)
   await assignMetadataPreservingActivity(tx.reportDraft as unknown as LegacyActivityModel,{visibility:'LEGACY'},privateData)
  })
  console.log(JSON.stringify(summary))
 }finally{await prisma.$disconnect()}
}
main().catch(()=>{console.error('Legacy ownership assignment failed; explicit IDs and provisioned membership are required.');process.exitCode=1})
