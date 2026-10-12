import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { randomUUID,createHash } from 'node:crypto'
import { OperationService } from '../../src/modules/operations/operation-service'
import { createOperationExecutors } from '../../src/modules/operations/executors'
import { dispatchOperations } from '../../src/modules/operations/operation-dispatcher'
import { importDocument } from '../../src/modules/documents/application/import-document'
import { extractDocumentVersion } from '../../src/modules/documents/application/extract-document'
import type { ObjectStore } from '../../src/modules/scan-runs/application/ports'
import type { AiModelClient } from '../../src/modules/ai/application/ai-model-client'
import { analyzeArchivedSourceRun } from '../../src/modules/operations/source-run-adapter'
import { StandaloneReportsService } from '../../src/modules/operations/standalone-reports'
import { defaultSections,templateHtml } from '../../src/modules/workspace/report-template-catalog'

const enabled = Boolean(process.env.TEST_DATABASE_URL)
describe.skipIf(!enabled)('modular workflow on isolated test database',()=>{
 const db = new PrismaClient(), scope=`operation-test-${randomUUID()}`, blobs=new Map<string,Buffer>()
 const objectStore = {
  putRunFile:async(key:string,body:Buffer,mediaType:string)=>{blobs.set(key,body);return{bucket:'isolated-test',objectKey:key,sha256:createHash('sha256').update(body).digest('hex'),mediaType,byteSize:BigInt(body.length)}},
  getContent:async(key:string)=>{const content=blobs.get(key);if(!content)throw new Error('missing object');return content},
 } as ObjectStore
 const ai: AiModelClient = {generateStructured:vi.fn(async request=>{
  const input=JSON.parse((request.parts[0] as {text:string}).text),document=input.documents[0]
  return {json:{schemaVersion:2,title:'Gümrük belgesi',summary:'Test özeti',detailedAnalysis:'Test analizi',changes:[{description:'Kural',evidenceIds:['e1']}],affectedParties:[],effectiveDates:[],unresolvedReferences:[],evidence:[{id:'e1',documentVersionId:document.id,excerpt:'Gümrük kuralı.'}]},providerRequestId:'fake-request',usage:{inputTokens:10,outputTokens:10}}
 })}
 const executors=createOperationExecutors({prisma:db,objectStore,aiModel:ai,model:'fake',extract:(id,s)=>extractDocumentVersion({prisma:db,objectStore},id,s)})
 const publication=new StandaloneReportsService(db,objectStore,scope)
 const service=new OperationService(db,{scope,executors,versions:{ANALYZE:'fake-v2',EXTRACT:'test-v1',BUILD_REPORT:'test-v1'}})
 let templateId:string
 beforeAll(async()=>{
  const url=new URL(process.env.TEST_DATABASE_URL!)
  if(!url.pathname.endsWith('_test') || url.port!=='45432') throw new Error('Integration requires explicit isolated port 45432 test database.')
  await db.$connect()
  templateId=(await db.reportTemplate.create({data:{name:`Test-${scope}`,html:templateHtml,sections:defaultSections}})).id
 })
 afterAll(async()=>{
  // Only this test scope, never truncate shared/application tables.
  const tasks=await db.operationTask.findMany({where:{actorScope:scope},select:{id:true}}),ids=tasks.map(t=>t.id)
  const reports=await db.topicReport.findMany({where:{actorScope:scope},select:{id:true}});await db.reportRevision.deleteMany({where:{reportId:{in:reports.map(r=>r.id)}}});await db.topicReport.deleteMany({where:{actorScope:scope}});await db.reportFieldEdit.deleteMany({where:{draft:{actorScope:scope}}});await db.reportDraft.deleteMany({where:{actorScope:scope}})
  await db.operationOutbox.deleteMany({where:{taskId:{in:ids}}});await db.operationArtifact.deleteMany({where:{taskId:{in:ids}}});await db.operationAttempt.deleteMany({where:{taskId:{in:ids}}});await db.operationTask.deleteMany({where:{actorScope:scope}});await db.operationRequest.deleteMany({where:{actorScope:scope}})
  await db.documentLink.deleteMany({where:{actorScope:scope}})
  await db.documentImport.deleteMany({where:{actorScope:scope}});await db.documentVersion.deleteMany({where:{document:{actorScope:scope}}});await db.document.deleteMany({where:{actorScope:scope}})
  await db.sourceScanRun.deleteMany({where:{source:{key:scope}}});await db.source.deleteMany({where:{key:scope}})
  await db.reportTemplate.delete({where:{id:templateId}});await db.$disconnect()
 })
 it('uploads, extracts, analyzes, builds and edits immutable drafts with fake AI',async()=>{
  const imported=await importDocument({prisma:db,objectStore},{actorScope:scope,bytes:Buffer.from(`Gümrük kuralı. Yeni düzenleme. ${scope}`),filename:'test.txt',idempotencyKey:'upload1'})
  expect(imported.version.extractionStatus).toBe('READY');expect(ai.generateStructured).not.toHaveBeenCalled()
  const analyze=await service.start({operation:'ANALYZE',mode:'FILL_MISSING',documentVersionIds:[imported.version.id]},'analysis1')
  expect(analyze.tasks).toHaveLength(1);await service.execute(analyze.tasks[0]!.id)
  const analyzed=await service.get(analyze.id);expect(analyzed.status).toBe('SUCCEEDED');expect(analyzed.tasks[0]!.artifacts[0]!.kind).toBe('ANALYSIS')
  const reused=await service.start({operation:'ANALYZE',mode:'REUSE_ONLY',documentVersionIds:[imported.version.id]},'analysis-cached')
  expect(reused.status).toBe('SUCCEEDED');expect(reused.tasks[0]!.reused).toBe(true);expect(ai.generateStructured).toHaveBeenCalledTimes(1)
  const build=await service.start({operation:'BUILD_REPORT',mode:'FILL_MISSING',analysisTaskId:analyzed.tasks[0]!.id,templateId},'report1');await service.execute(build.tasks[0]!.id)
  const built=await service.get(build.id),artifact=built.tasks[0]!.artifacts[0]!,data=artifact.data as Record<string,any>
  expect(data.publicationStatus).toBe('DRAFT');expect(data.html).toContain('Test özeti');expect(data.html).toContain('data:image/png;base64,');expect(data.sourceContext[0].classification).toBe('USER_PROVIDED');expect(data.sourceContext[0].url).toBeNull();expect(data.sourceContext[0].publishedOn).toBeNull()
  const revise=await service.start({operation:'REVISE_REPORT',mode:'FORCE',reportTaskId:built.tasks[0]!.id,reportEdits:{summary:'Elle düzeltilmiş özet <script>bad()</script>'}},'revise1');await service.execute(revise.tasks[0]!.id)
  const revised=await service.get(revise.id),next=revised.tasks[0]!.artifacts[0]!.data as Record<string,any>
  expect(next.html).toContain('Elle düzeltilmiş özet');expect(next.html).not.toContain('<script>bad()');expect(next.previousReportTaskId).toBe(built.tasks[0]!.id);expect((await service.get(build.id)).tasks[0]!.artifacts[0]!.data).toEqual(data);expect(ai.generateStructured).toHaveBeenCalledTimes(1)
  expect((await publication.publication(built.tasks[0]!.id)).expectedVersion).toBe(0)
  const cachedDraft=await service.start({operation:'BUILD_REPORT',mode:'REUSE_ONLY',analysisTaskId:analyzed.tasks[0]!.id,templateId},'report-cached')
  expect(cachedDraft.status).toBe('SUCCEEDED');expect(cachedDraft.tasks[0]!.reused).toBe(true)
  const firstPublished=await publication.publish(built.tasks[0]!.id,0)
  expect(await publication.publish(built.tasks[0]!.id,0)).toEqual(firstPublished)
  expect((await publication.publication(cachedDraft.tasks[0]!.id)).isPublished).toBe(true);expect(await publication.publish(cachedDraft.tasks[0]!.id,0)).toEqual(firstPublished)
  expect((await publication.publication(revised.tasks[0]!.id)).expectedVersion).toBe(1)
  await expect(publication.publish(revised.tasks[0]!.id,0)).rejects.toMatchObject({statusCode:409})
  const secondPublished=await publication.publish(revised.tasks[0]!.id,1);expect(secondPublished.reportId).toBe(firstPublished.reportId);expect(secondPublished.version).toBe(2)
  expect((await publication.revision(firstPublished.reportId,1)).reportContent.summary).toBe('Test özeti');expect((await publication.revision(firstPublished.reportId,2)).reportContent.summary).toContain('Elle düzeltilmiş')
  const archived=await publication.get(firstPublished.reportId);expect(archived.revisions.map(r=>r.operationTaskId)).toEqual([revised.tasks[0]!.id,built.tasks[0]!.id]);expect((await publication.list()).reports).toHaveLength(1)
  expect(await db.operationOutbox.count({where:{taskId:reused.tasks[0]!.id}})).toBe(0)
  await expect(service.start({operation:'BUILD_REPORT',mode:'FORCE',analysisTaskId:analyzed.tasks[0]!.id},'analysis1')).rejects.toMatchObject({statusCode:409})
 })
 it('claims duplicate deliveries once and fences publication after cancellation',async()=>{
  let release!:()=>void;const pending=new Promise<void>(r=>{release=r}),entered=vi.fn()
  const controlled=new OperationService(db,{scope,executors:{TARIFF_LOOKUP:async()=>{entered();await pending;return[{kind:'TARIFF_RESULT',data:{test:true}}]}}})
  const req=await controlled.start({operation:'TARIFF_LOOKUP',mode:'FORCE',code:'123456',date:'2026-10-11'},'cancel1'),id=req.tasks[0]!.id
  const run=controlled.execute(id)
  await vi.waitFor(()=>expect(entered).toHaveBeenCalledTimes(1))
  await controlled.execute(id);expect(entered).toHaveBeenCalledTimes(1)
  await controlled.cancel(req.id);release();await run
  const cancelled=await controlled.get(req.id);expect(cancelled.status).toBe('CANCELLED');expect(cancelled.tasks[0]!.artifacts).toHaveLength(0)
 })
 it('persists outbox until confirmed and recovers expired task lease',async()=>{
  const controlled=new OperationService(db,{scope,executors:{TARIFF_LOOKUP:async()=>[{kind:'TARIFF_RESULT'}]}})
  const req=await controlled.start({operation:'TARIFF_LOOKUP',mode:'FORCE',code:'654321',date:'2026-10-11'},'dispatch1'),task=req.tasks[0]!
  const queue={send:vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue('receipt')}
  await dispatchOperations(db,queue)
  const first=await db.operationOutbox.findFirstOrThrow({where:{taskId:task.id}});expect(first.status).toBe('PENDING');expect(first.errorMessage).toBe('Unavailable')
  await db.operationOutbox.update({where:{id:first.id},data:{availableAt:new Date(0)}});await dispatchOperations(db,queue)
  expect((await db.operationOutbox.findUniqueOrThrow({where:{id:first.id}})).status).toBe('DISPATCHED')
  await db.operationTask.update({where:{id:task.id},data:{status:'RUNNING',leaseOwner:'dead-worker',leaseUntil:new Date(0)}})
  await dispatchOperations(db,queue)
  expect(await db.operationOutbox.count({where:{taskId:task.id}})).toBe(2);await controlled.execute(task.id);expect((await controlled.get(req.id)).status).toBe('SUCCEEDED')
 })
 it('does not auto retry permission failures and retries transient provider outages durably',async()=>{
  const permanent=new OperationService(db,{scope,executors:{TARIFF_LOOKUP:async()=>{throw Object.assign(new Error('secret-provider-response'),{category:'PERMISSION'})}}})
  const a=await permanent.start({operation:'TARIFF_LOOKUP',mode:'FORCE',code:'111111',date:'2026-10-11'},'permission1');await permanent.execute(a.tasks[0]!.id)
  const failed=await permanent.get(a.id);expect(failed.status).toBe('FAILED');expect(failed.tasks[0]!.errorMessage).not.toContain('secret-provider-response');expect(await db.operationOutbox.count({where:{taskId:a.tasks[0]!.id}})).toBe(1)
  const retrying=new OperationService(db,{scope,executors:{TARIFF_LOOKUP:async()=>{throw Object.assign(new Error('temporary'),{category:'PROVIDER_UNAVAILABLE'})}}})
  const b=await retrying.start({operation:'TARIFF_LOOKUP',mode:'FORCE',code:'222222',date:'2026-10-11'},'transient1');await retrying.execute(b.tasks[0]!.id)
  expect((await retrying.get(b.id)).status).toBe('QUEUED');expect(await db.operationOutbox.count({where:{taskId:b.tasks[0]!.id}})).toBe(2)
  // Make the test scope terminal so it does not get picked up by another test's dispatcher.
  await retrying.cancel(b.id)
 })
 it('rejects stale owner publication after another worker completes the task',async()=>{
  let release!:()=>void;const blocked=new Promise<void>(r=>{release=r});let calls=0
  const controlled=new OperationService(db,{scope,executors:{TARIFF_LOOKUP:async()=>{const n=++calls;if(n===1)await blocked;return[{kind:'TARIFF_RESULT',data:{worker:n}}]}}})
  const req=await controlled.start({operation:'TARIFF_LOOKUP',mode:'FORCE',code:'333333',date:'2026-10-11'},'stale1'),id=req.tasks[0]!.id
  const old=controlled.execute(id);await vi.waitFor(()=>expect(calls).toBe(1))
  await db.operationTask.update({where:{id},data:{leaseUntil:new Date(0)}})
  await controlled.execute(id);expect(calls).toBe(2);release();await old
  const final=await controlled.get(req.id);expect(final.status).toBe('SUCCEEDED');expect(final.tasks[0]!.artifacts).toHaveLength(1);expect(final.tasks[0]!.artifacts[0]!.data).toEqual({worker:2})
 })

 it('reanalyzes archived source inputs without requeuing discovery or the parent scan',async()=>{
  const source=await db.source.create({data:{key:scope,name:'Test kaynak',baseUrl:'https://example.test',authorityType:'SUPPORTING'}})
  const run=await db.sourceScanRun.create({data:{sourceId:source.id,requestKey:`source-${scope}`,targetDate:new Date('2026-10-11'),status:'COMPLETED',documents:{create:{url:`https://example.test/${scope}`,title:'Arşiv belgesi',publishedOn:null,feedUrl:'https://example.test/list',contentText:'Gümrük kuralı. Arşivlenmiş içerik.',processingStatus:'PENDING'}}}})
  const snapshot=await db.sourceScanRun.findUniqueOrThrow({where:{id:run.id}})
  const response=await analyzeArchivedSourceRun(db,service,run.id,'source-adapter1')
  expect(response.operationRequestIds).toHaveLength(1)
  const request=await service.get(response.operationRequestIds[0]!);expect(request.sourceRunId).toBe(run.id);expect(request.tasks.map(t=>t.operation)).toEqual(['ANALYZE']);expect(await db.sourceScanRun.findUniqueOrThrow({where:{id:run.id}})).toEqual(snapshot)
  const duplicate=await analyzeArchivedSourceRun(db,service,run.id,'source-adapter1');expect(duplicate.operationRequestIds).toEqual(response.operationRequestIds)
  const selected=request.tasks[0]!.parameters as Record<string,any>,version=await db.documentVersion.findUniqueOrThrow({where:{id:selected.documentVersionIds[0]},include:{document:true}})
  expect(version.document.origin).toBe('SOURCE');expect(version.document.publishedOn).toBeNull();expect(version.fetchedAt).toBeNull();expect((version.extractionMetadata as Record<string,unknown>).contentBasis).toBe('RECORDED_TEXT')
  await service.execute(request.tasks[0]!.id);expect((await service.get(request.id)).status).toBe('SUCCEEDED')
 })

 it('keeps partial discovery truthful and allows an explicit retry without caching incomplete coverage',async()=>{
  const source=await db.source.findUniqueOrThrow({where:{key:scope}})
  const controlled=new OperationService(db,{scope,executors:{DISCOVER:async()=>[{kind:'DISCOVERY',data:{coverage:'PARTIAL',pages:['first'],warnings:['second page unavailable']}}]}})
  const req=await controlled.start({operation:'DISCOVER',mode:'FILL_MISSING',sourceId:source.id,date:'2026-10-11'},'partial1');await controlled.execute(req.tasks[0]!.id)
  const result=await controlled.get(req.id);expect(result.status).toBe('PARTIAL');expect(result.tasks[0]!.status).toBe('PARTIAL');expect(result.tasks[0]!.artifacts).toHaveLength(1)
  const preview=await controlled.plan({operation:'DISCOVER',mode:'REUSE_ONLY',sourceId:source.id,date:'2026-10-11'});expect(preview.canStart).toBe(false);expect(preview.tasks[0]!.reused).toBe(false)
  await controlled.retry(req.tasks[0]!.id);expect((await controlled.get(req.id)).status).toBe('QUEUED');await controlled.cancel(req.id)
 })

 it('archives Tariff evidence and reuses it for analysis and revision without another lookup',async()=>{
  await db.source.upsert({where:{key:'tariff'},create:{key:'tariff',name:'Tariff',baseUrl:'https://tariff.singlewindow.io',authorityType:'SUPPORTING'},update:{}})
  const tariff={lookup:vi.fn().mockResolvedValue({code:'123456000000',date:'2026-10-11',description:'Gümrük kuralı.',source:`https://tariff.singlewindow.io/api/query?scope=${scope}`,fetchedAt:new Date().toISOString(),classification:'SUPPORTING_NON_AUTHORITATIVE',comparisons:[],notes:[]})}
  const local=new OperationService(db,{scope,executors:createOperationExecutors({prisma:db,objectStore,aiModel:ai,model:'fake',tariffLookup:tariff,extract:(id,s)=>extractDocumentVersion({prisma:db,objectStore},id,s)})})
  const lookup=await local.start({operation:'TARIFF_LOOKUP',mode:'FORCE',code:'123456',date:'2026-10-11'},'tariff-evidence1');await local.execute(lookup.tasks[0]!.id)
  const completed=await local.get(lookup.id),artifact=completed.tasks[0]!.artifacts.find(a=>a.kind==='TARIFF_RESULT')!,versionId=(artifact.data as Record<string,string>).documentVersionId!
  const version=await db.documentVersion.findUniqueOrThrow({where:{id:versionId},include:{document:true}});expect(version.document.publishedOn).toBeNull();expect(version.extractionStatus).toBe('READY');expect(version.storedObjectId).toBeTruthy();expect((version.extractionMetadata as Record<string,unknown>).classification).toBe('SUPPORTING_NON_AUTHORITATIVE')
  const analyze=await local.start({operation:'ANALYZE',mode:'FORCE',documentVersionIds:[versionId]},'tariff-analysis1');await local.execute(analyze.tasks[0]!.id)
  const analyzed=await local.get(analyze.id);expect(analyzed.status).toBe('SUCCEEDED');expect(((analyzed.tasks[0]!.artifacts[0]!.data as Record<string,any>).sourceContext)[0].classification).toBe('SUPPORTING_NON_AUTHORITATIVE')
  const extra=await importDocument({prisma:db,objectStore},{actorScope:scope,filename:'ek.txt',bytes:Buffer.from(`Gümrük kuralı. Ek kanıt ${scope}`),idempotencyKey:'extra-tariff-revision'})
  const revised=await local.start({operation:'REVISE_ANALYSIS',mode:'FORCE',analysisTaskId:analyzed.tasks[0]!.id,documentVersionIds:[extra.version.id],instruction:'Tariff ile ek belgeyi karşılaştır.'},'tariff-analysis-revision1');await local.execute(revised.tasks[0]!.id)
  const revisedResult=await local.get(revised.id);expect(revisedResult.status).toBe('SUCCEEDED');expect((revisedResult.tasks[0]!.artifacts[0]!.data as Record<string,any>).sourceContext.map((c:any)=>c.documentVersionId).sort()).toEqual([versionId,extra.version.id].sort());expect(tariff.lookup).toHaveBeenCalledTimes(1)
 })

})
