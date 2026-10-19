import { buildApp } from '../../src/app'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { executeV2Scan, importPipelineResults, type PipelineSnapshot } from '../../src/modules/v2-integration/pipeline'
import { runWithActorContext, type ActorContext } from '../../src/platform/actor-context'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'
import { PrismaTopicAnalysisRepository } from '../../src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'
const suite=process.env.TEST_DATABASE_URL?describe:describe.skip
suite('V2 results in existing application screens',()=>{
 const prisma=new PrismaClient(),userId=randomUUID(),suffix=randomUUID()
 const blobs=new Map<string,Buffer>()
 const store={getContent:async(key:string)=>blobs.get(key)!,putRunFile:async(key:string,bytes:Buffer,mediaType:string)=>{blobs.set(key,bytes);return {bucket:'test',objectKey:key,mediaType,byteSize:BigInt(bytes.length),sha256:'test'}}}
 let actor:ActorContext
 const snapshot:PipelineSnapshot={id:randomUUID(),date:'2026-09-06',status:'COMPLETED',done:true,steps:[{nodeId:'render',total:1,succeeded:1,failed:0,skipped:0,closed:true}],calls:[],failures:[],discovery:{precheck:{editions:[{url:'https://www.resmigazete.gov.tr/06.09.2026',mukerrer:null,issue:'33000'}]}},documents:[{id:randomUUID(),title:'Gümrük Tebliği',url:`https://www.resmigazete.gov.tr/test/${suffix}`,context:{position:1},decision:'IN',reason:'Dış ticaret',files:[{role:'ORIGINAL',url:null,sha256:suffix.replaceAll('-','').padEnd(64,'a'),objectKey:`test/${suffix}`,mime:'text/html',bytes:10}]}],reports:[{id:randomUUID(),revision:1,htmlKey:`v2/${suffix}`,html:'<!doctype html><html><head></head><body><header>ATEZ</header><article class="card"><h2>V2 test raporu</h2></article></body></html>',spec:{headline:'Gümrük değişikliği',templateVersionId:randomUUID(),sections:[]},analysis:{summary:'İthalat işlemleri değişti.',operationalImpact:'Yeni oran uygulanır.',affected:{parties:['İthalatçılar']},dates:{effective:[]},documents:[{title:'Tebliğ',url:'https://www.resmigazete.gov.tr'}]}}]}
 beforeAll(async()=>{const w=await prisma.workspace.upsert({where:{key:'atez'},create:{key:'atez',name:'Test'},update:{}});await prisma.user.create({data:{id:userId,email:`v2-${suffix}@example.invalid`}});actor={userId,workspaceId:w.id,identityId:'test',role:'ADMIN',permissions:[],issuer:'test',subject:'test'}})
 afterAll(async()=>{
  await prisma.documentLink.deleteMany({where:{ownerUserId:userId}})
  await prisma.documentVersion.deleteMany({where:{document:{ownerUserId:userId}}})
  await prisma.document.deleteMany({where:{ownerUserId:userId}})
  await prisma.scanRun.deleteMany({where:{initiatorUserId:userId}})
  await prisma.storedObject.deleteMany({where:{objectKey:`test/${suffix}`}})
  await prisma.user.deleteMany({where:{id:userId}})
  await prisma.$disconnect()
 })
 const createRun=()=>prisma.scanRun.create({data:{requestKey:randomUUID(),targetDate:new Date(snapshot.date),workspaceId:actor.workspaceId,initiatorUserId:userId,sourceKeys:['resmi-gazete'],workspaceConfig:{engine:'v2'}}})
 it('imports reports and documents idempotently; existing screens read them and another user cannot',async()=>runWithActorContext(actor,async()=>{
  const run=await createRun()
  await importPipelineResults(prisma,run.id,snapshot,store)
  await importPipelineResults(prisma,run.id,snapshot,store)
  const detail=await new PrismaScanRepository(prisma).getRun(run.id)
  expect(detail?.status).toBe('COMPLETED')
  const reports=await prisma.topicReport.findMany({where:{scanRunId:run.id},include:{revisions:true}})
  expect(reports).toHaveLength(1);expect(reports[0]!.revisions).toHaveLength(1)
  expect(blobs.get(reports[0]!.revisions[0]!.htmlObjectKey!)?.toString()).toContain('V2 test raporu')
  const repository=new PrismaTopicAnalysisRepository(prisma)
  expect(await repository.getTopicDetail(reports[0]!.id)).toMatchObject({title:'Gümrük değişikliği',reportVersion:1})
  expect(await runWithActorContext({...actor,userId:randomUUID()},()=>repository.getTopicDetail(reports[0]!.id))).toBeNull()
  expect(await prisma.documentLink.count({where:{scanRunId:run.id}})).toBe(1)
  const second=await createRun();await importPipelineResults(prisma,second.id,snapshot,store)
  expect(await prisma.topicReport.count({where:{scanRunId:second.id}})).toBe(1)
  const app=await buildApp({authRuntime:false,objectStore:store})
  try {
   const html=await app.inject({method:'GET',url:`/api/v1/scan-runs/${run.id}/reports/${reports[0]!.id}/html`})
   expect(html.statusCode).toBe(200)
   expect(html.body).toContain('V2 test raporu')
   const draft=await app.inject({method:'POST',url:`/api/v1/topics/${reports[0]!.id}/draft/edits`,headers:{'idempotency-key':randomUUID()},payload:{expectedVersion:1,edits:[{path:'customization.customHtml',value:'<h2>QA düzeltmesi</h2><p>Kaydedilmiş yeni içerik</p>'}]}})
   expect(draft.statusCode).toBe(200)
   const published=await app.inject({method:'POST',url:`/api/v1/topics/${reports[0]!.id}/draft/publish`,payload:{expectedVersion:1}})
   expect(published.statusCode).toBe(201)
   const edited=await app.inject({method:'GET',url:`/api/v1/topics/${reports[0]!.id}/reports/2/html`})
   expect(edited.body).toContain('QA düzeltmesi')
  } finally {await app.close()}
  // Re-delivery must not replace a user's newer revision or the old immutable artifact.
  const originalBytes=blobs.get(reports[0]!.revisions[0]!.htmlObjectKey)
  snapshot.reports[0]!.html='<html><body>Changed upstream</body></html>'
  await importPipelineResults(prisma,run.id,snapshot,store)
  expect((await prisma.topicReport.findUniqueOrThrow({where:{id:reports[0]!.id}})).latestVersion).toBe(2)
  expect(blobs.get(reports[0]!.revisions[0]!.htmlObjectKey)).toEqual(originalBytes)
 }))
 it('creates an immutable no-change bulletin only after successful scope filtering',async()=>runWithActorContext(actor,async()=>{
  const run=await createRun()
  const empty={...snapshot,reports:[],documents:snapshot.documents.map(d=>({...d,decision:'OUT'}))}
  await importPipelineResults(prisma,run.id,empty,store)
  await importPipelineResults(prisma,run.id,empty,store)
  const reports=await prisma.topicReport.findMany({where:{scanRunId:run.id},include:{revisions:true}})
  expect(reports).toHaveLength(1);expect(reports[0]?.card).toBe('K6');expect(reports[0]?.revisions).toHaveLength(1)
  expect(blobs.get(reports[0]!.revisions[0]!.htmlObjectKey)?.toString()).toContain('Kapsam içi değişiklik yok')
 }))
 it('executes with actor context and records failures without reporting success',async()=>runWithActorContext(actor,async()=>{
  const run=await createRun(),start=vi.fn().mockResolvedValue(snapshot.id)
  await executeV2Scan(prisma,{runId:run.id,outboxId:randomUUID(),type:'START_SCAN'},store,{start,snapshot:async()=>({...snapshot,status:'FAILED',reports:[],failures:[{node:'analyze',error:'fixture'}]}),close:async()=>{}})
  expect(start).toHaveBeenCalledWith(expect.any(String),{date:snapshot.date},{kind:'user',workspaceId:actor.workspaceId,userId})
  expect((await prisma.scanRun.findUniqueOrThrow({where:{id:run.id}})).status).toBe('FAILED')
  const repository=new PrismaScanRepository(prisma)
  expect((await repository.getRun(run.id))?.v2RetryAvailable).toBe(true)
  const key=randomUUID(),retry=await repository.requestAiFilterRetry(run.id,key)
  expect(await repository.requestAiFilterRetry(run.id,key)).toEqual(retry)
  expect((await prisma.scanRun.findUniqueOrThrow({where:{id:run.id}})).status).toBe('QUEUED')
  expect((await repository.getRun(run.id))?.v2RetryAvailable).toBe(false)
 }))
})
