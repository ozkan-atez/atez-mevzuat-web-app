import {afterAll,beforeAll,describe,expect,it} from 'vitest'
import {randomUUID} from 'node:crypto'
import {PrismaClient} from '@prisma/client'
import {runWithActorContext,permissionsForRole,type ActorContext} from '../../src/platform/actor-context'
import {PrismaTopicAnalysisRepository} from '../../src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'
import {PrismaScanRepository} from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'
import {PrismaDeliveryRepository} from '../../src/modules/delivery/infrastructure/prisma-delivery-repository'
const suite=process.env.TEST_DATABASE_URL?describe:describe.skip
suite('private report fences legacy topic and run delivery paths',()=>{
 const prisma=new PrismaClient(),suffix=randomUUID(),users=[randomUUID(),randomUUID()],runId=randomUUID(),repo=new PrismaTopicAnalysisRepository(prisma),scanRepo=new PrismaScanRepository(prisma),delivery=new PrismaDeliveryRepository(prisma)
 let workspaceId:string,topicId:string,emptyTopicId:string,reportId:string,k6Id:string,messageId:string
 const actor=(index:number):ActorContext=>({userId:users[index]!,identityId:`i${index}`,workspaceId,role:'EDITOR',permissions:permissionsForRole('EDITOR'),issuer:'https://test.invalid',subject:`s${index}`})
 beforeAll(async()=>{
  workspaceId=(await prisma.workspace.upsert({where:{key:'atez'},create:{key:'atez',name:'Test'},update:{}})).id
  for(const [index,id] of users.entries())await prisma.user.create({data:{id,email:`report-scope-${suffix}-${index}@example.invalid`}})
  const run=await prisma.scanRun.create({data:{id:runId,requestKey:`private-lineage-${suffix}`,targetDate:new Date('2026-10-10'),editions:{create:{publicationDate:new Date('2026-10-10'),type:'MAIN',indexUrl:`https://example.invalid/${suffix}`,discoveryOrder:0,documents:{create:[{title:'Public source one',sourceUrl:`https://example.invalid/${suffix}/one`,publicationOrder:1},{title:'Public source two',sourceUrl:`https://example.invalid/${suffix}/two`,publicationOrder:2}]}}}},include:{editions:{include:{documents:true}}}})
  const docs=run.editions[0]!.documents
  for(const [index,doc] of docs.entries()){
   const topic=await prisma.topicProcess.create({data:{scanRunId:runId,documentId:doc.id,status:'AWAITING_RETRY',thread:{create:{messages:{create:{role:'USER',kind:'REVISION_REQUEST',revisionKind:'ANALYSIS',content:'Private conversation'}}}},analyses:{create:{version:1,status:'PASS',analysisObjectKey:`private-analysis-${suffix}-${index}`,markdownObjectKey:`private-markdown-${suffix}-${index}`,model:'fake',promptVersion:'fake',schemaVersion:1}}},include:{thread:{include:{messages:true}}}})
   if(index===0){topicId=topic.id;messageId=topic.thread!.messages[0]!.id}else emptyTopicId=topic.id
  }
  const own={workspaceId,ownerUserId:users[0]!,visibility:'PRIVATE',actorScope:`workspace:${workspaceId}:user:${users[0]}`}
  reportId=(await prisma.topicReport.create({data:{...own,scanRunId:runId,topicId,title:'Private generated report',basename:'private',card:'K1',latestVersion:1,revisions:{create:{version:1,status:'VALIDATED',card:'K1',specObjectKey:`private-spec-${suffix}`,htmlObjectKey:`private-html-${suffix}`}}}})).id
  k6Id=(await prisma.topicReport.create({data:{...own,scanRunId:runId,title:'Private no-change report',basename:'private-k6',card:'K6',latestVersion:1,revisions:{create:{version:1,status:'VALIDATED',card:'K6',specObjectKey:`private-k6-spec-${suffix}`,htmlObjectKey:`private-k6-html-${suffix}`}}}})).id
  await prisma.emailDispatch.create({data:{topicId,reportVersion:1,requestKey:`dispatch-${suffix}`,recipients:['example@example.invalid'],groupIds:[],subject:'Private mail subject',bodyHtml:'Private mail body'}})
 })
 afterAll(async()=>{await prisma.scanRun.deleteMany({where:{id:runId}});await prisma.user.deleteMany({where:{id:{in:users}}});await prisma.$disconnect()})
 it('denies private HTML, context, details, messages, analysis lineage and delivery records to a different member',async()=>{
  await runWithActorContext(actor(1),async()=>{
   expect(await repo.getTopicReportHtmlKey(topicId,1)).toBeNull();expect(await repo.getRunReportHtmlKey(runId,k6Id)).toBeNull();expect(await repo.getTopicReportContext(topicId,1)).toBeNull();expect(await repo.getTopic(topicId)).toBeNull();expect(await repo.getTopicDetail(topicId)).toBeNull();expect(await repo.getTopicRevisionMessage(topicId,messageId)).toBeNull();expect(await delivery.listTopicDispatches(topicId)).toEqual([])
   await expect(repo.appendRevisionRequest({topicId,requestKey:'blocked',message:'No access',revisionKind:'ANALYSIS'})).rejects.toThrow('Topic bulunamadı')
   await expect(repo.requestTopicRetry(topicId,'blocked')).rejects.toThrow('Topic bulunamadı')
   const run=await scanRepo.getRun(runId);expect(JSON.stringify(run)).not.toContain(reportId);expect(JSON.stringify(run)).not.toContain(k6Id);expect(JSON.stringify(run)).not.toContain(`private-html-${suffix}`)
  })
 })
 it('allows the owner and preserves status-only source details before a report exists',async()=>{
  await runWithActorContext(actor(0),async()=>{expect(await repo.getTopicReportHtmlKey(topicId,1)).toBe(`private-html-${suffix}`);expect(await repo.getRunReportHtmlKey(runId,k6Id)).toBe(`private-k6-html-${suffix}`)})
  await runWithActorContext(actor(1),async()=>{const detail=await repo.getTopicDetail(emptyTopicId);expect(detail).toMatchObject({id:emptyTopicId,status:'AWAITING_RETRY',analyses:[],thread:{messages:[]}});expect((await repo.listRunTopicDetails(runId)).map(t=>t.id)).toEqual([emptyTopicId])})
 })
})
