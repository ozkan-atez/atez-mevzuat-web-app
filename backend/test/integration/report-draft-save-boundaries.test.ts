import {PrismaClient} from '@prisma/client'
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import {PrismaTopicAnalysisRepository} from '../../src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'
import {PrismaReportDraftRepository} from '../../src/modules/topic-analysis/infrastructure/prisma-report-draft-repository'
import {applyReportFieldEdits,ReportDraftBusyError,ReportDraftChangedError} from '../../src/modules/topic-analysis/application/apply-report-field-edits'
import {publishReportDraft} from '../../src/modules/topic-analysis/application/publish-report-draft'
import {executeTopicRevision} from '../../src/modules/topic-analysis/application/execute-topic-revision'
import {executePromptPatch} from '../../src/modules/topic-analysis/application/execute-prompt-patch'
import {AiProviderError} from '../../src/modules/ai/domain/ai-errors'
import {ReportSpecSchema} from '../../src/modules/topic-analysis/domain/report-spec-schemas'
import type {TopicObjectStore} from '../../src/modules/topic-analysis/application/ports'
const enabled=Boolean(process.env.TEST_DATABASE_URL)
describe.skipIf(!enabled)('report correction Save boundaries on isolated database',()=>{
 const prisma=new PrismaClient(),topics=new PrismaTopicAnalysisRepository(prisma),drafts=new PrismaReportDraftRepository(prisma),runs:string[]=[]
 beforeAll(async()=>{const url=new URL(process.env.TEST_DATABASE_URL!);if(url.port!=='45432'||!url.pathname.endsWith('_test'))throw new Error('Dedicated port45432 test database required.');await prisma.$connect()})
 afterAll(async()=>{await prisma.scanRun.deleteMany({where:{id:{in:runs}}});await prisma.$disconnect()})
 const seed=async()=>{
  const run=await prisma.scanRun.create({data:{requestKey:randomUUID(),targetDate:new Date('2026-10-11'),editions:{create:{publicationDate:new Date('2026-10-11'),type:'MAIN',indexUrl:'https://www.resmigazete.gov.tr/11.10.2026',discoveryOrder:0,documents:{create:{title:'İthalat Tebliği',sourceUrl:'https://www.resmigazete.gov.tr/current',publicationOrder:0}}}}},include:{editions:{include:{documents:true}}}});runs.push(run.id)
  const job=await prisma.aiJob.create({data:{scanRunId:run.id,kind:'DOCUMENT_FILTER',model:'fake',status:'COMPLETED',titlePromptVersion:'1',contentPromptVersion:'1',configurationHash:'a'.repeat(64)}})
  await prisma.documentFilterDecision.create({data:{aiJobId:job.id,documentId:run.editions[0]!.documents[0]!.id,titleDecision:'IN',titleReason:'İlgili',titleConfidence:1,finalDecision:'IN'}})
  const topic=(await topics.ensureTopics(run.id))[0]!
  const analysis=await topics.createAnalysisRevision({topicId:topic.id,version:1,status:'PASS',analysisObjectKey:`${topic.id}/analysis1.json`,markdownObjectKey:`${topic.id}/analysis1.md`,model:'fake',promptVersion:'1',schemaVersion:1,inputTokens:null,outputTokens:null})
  const spec=ReportSpecSchema.parse({schemaVersion:1,templateFamily:'bulten-v2',reportId:'111026-01',topicId:topic.id,card:'K1',documentTitle:'ATEZ Mevzuat Radarı Günlük Raporu',issueNumber:'33380',displayDate:'11 Ekim 2026',typeLabel:'Düzenleme',title:'Orijinal başlık',summary:'Orijinal özet',affectedParties:[],dates:[],note:null,source:{label:'T.C. Resmî Gazete',url:'https://www.resmigazete.gov.tr/current'},blocks:['B1','B2','B3','B10']})
  const originalSpecKey=`${topic.id}/r1.json`,originalHtmlKey=`${topic.id}/r1.html`,values=new Map<string,Buffer>([[originalSpecKey,Buffer.from(JSON.stringify(spec))],[originalHtmlKey,Buffer.from('immutable original html')],[analysis.analysisObjectKey,Buffer.from('{}')]])
  const store:TopicObjectStore={getContent:async(key)=>{const bytes=values.get(key);if(!bytes)throw new Error(`Missing ${key}`);return bytes},putRunFile:async(key,body,mediaType)=>{values.set(key,body);return{objectKey:key,sha256:'f'.repeat(64),mediaType,byteSize:BigInt(body.length)}}}
  await topics.createReportRevision({scanRunId:run.id,topicId:topic.id,analysisRevisionId:analysis.id,title:'Orijinal başlık',basename:`01-${topic.id}.html`,card:'K1',version:1,specObjectKey:originalSpecKey,htmlObjectKey:originalHtmlKey})
  const edit=async(path:string,value:string)=>applyReportFieldEdits({topicId:topic.id,patch:{edits:[{path,value}]},requestKey:randomUUID(),source:'USER',prompt:null,chatMessageId:null,actor:null},{repository:drafts,objectStore:store})
  return{topicId:topic.id,runId:run.id,analysis,spec,store,values,originalSpecKey,originalHtmlKey,edit,save:()=>publishReportDraft({topicId:topic.id,expectedVersion:1},{repository:drafts,topicRepository:topics,objectStore:store})}
 }
 it('accumulates manual edits and publication prompts in one draft, then saves one immutable revision',async()=>{
  const f=await seed();await f.edit('title','Elle düzeltilmiş başlık')
  const thread=await prisma.analysisThread.findUniqueOrThrow({where:{topicId:f.topicId}}),message=await prisma.chatMessage.create({data:{threadId:thread.id,role:'USER',kind:'REVISION_REQUEST',revisionKind:'PUBLICATION',content:'Özeti sadeleştir.'}})
  await prisma.topicOutbox.create({data:{topicId:f.topicId,command:'REVISE_PUBLICATION',messageId:message.id,requestKey:randomUUID()}})
  expect(await topics.hasPendingReportRevisionWork(f.topicId)).toBe(true)
  await expect(f.save()).rejects.toBeInstanceOf(ReportDraftBusyError)
  const model={generateStructured:vi.fn(async()=>({json:{...f.spec,title:'Elle düzeltilmiş başlık',summary:'AI ile sadeleştirilmiş özet'},providerRequestId:'fake',usage:{inputTokens:1,outputTokens:1}}))}
  const deps={repository:topics,draftRepository:drafts,objectStore:f.store,aiModel:model,model:'fake',maxContextBytes:1000}
  await executeTopicRevision({topicId:f.topicId,messageId:message.id},deps)
  const draft=await drafts.getOpenDraft(f.topicId);expect(draft?.edits).toHaveLength(2);expect(await topics.hasPendingReportRevisionWork(f.topicId)).toBe(false)
  expect(await prisma.reportRevision.count({where:{report:{topicId:f.topicId}}})).toBe(1)
  await f.edit('note','Üçüncü düzenleme')
  const saved=await f.save();expect(saved.version).toBe(2);expect(await prisma.reportRevision.count({where:{report:{topicId:f.topicId}}})).toBe(2);expect(await drafts.getOpenDraft(f.topicId)).toBeNull()
  const history=await drafts.getPublishedHistory(f.topicId);expect(history).toHaveLength(2);expect(history[1]!.version).toBe(1);expect(history[1]!.edits).toEqual([]);expect(history[0]!.version).toBe(2);expect(history[0]!.edits.map(e=>e.path)).toEqual(['title','summary','note']);expect(history[0]!.edits.every(e=>!e.revertible)).toBe(true)
  expect(f.values.get(f.originalHtmlKey)?.toString()).toBe('immutable original html');expect(JSON.parse(f.values.get(f.originalSpecKey)!.toString()).summary).toBe('Orijinal özet')
  await executeTopicRevision({topicId:f.topicId,messageId:message.id},deps);expect(model.generateStructured).toHaveBeenCalledTimes(1);expect(await drafts.getOpenDraft(f.topicId)).toBeNull()
 })
 it('keeps an escalated analysis pending until its own result, and clears terminal permission failures',async()=>{
  const f=await seed();await f.edit('note','İlk değişiklik')
  const req=await topics.appendRevisionRequest({topicId:f.topicId,requestKey:randomUUID(),message:'Düzenle',revisionKind:'DIRECT_EDIT'})
  await topics.appendRevisionResult(f.topicId,{role:'ASSISTANT',kind:'REVISION_RESULT',revisionKind:'DIRECT_EDIT',content:'Analize aktarıldı',requestKey:`escalated:${req.messageId}`})
  await prisma.topicOutbox.create({data:{topicId:f.topicId,command:'REVISE_ANALYSIS',messageId:req.messageId,requestKey:randomUUID()}})
  expect(await topics.hasPendingReportRevisionWork(f.topicId)).toBe(true)
  await topics.appendRevisionResult(f.topicId,{role:'ASSISTANT',kind:'ERROR',revisionKind:'ANALYSIS',content:'İzin hatası',requestKey:`revision-error:${req.messageId}`})
  expect(await topics.hasPendingReportRevisionWork(f.topicId)).toBe(false)
  const failed=await topics.appendRevisionRequest({topicId:f.topicId,requestKey:randomUUID(),message:'Özeti düzelt',revisionKind:'DIRECT_EDIT'})
  await executePromptPatch({topicId:f.topicId,messageId:failed.messageId},{repository:topics,draftRepository:drafts,objectStore:f.store,aiModel:{generateStructured:vi.fn().mockRejectedValue(new AiProviderError('PERMISSION',false,'İzin yok'))},model:'fake',maxAttempts:1})
  expect(await topics.hasPendingReportRevisionWork(f.topicId)).toBe(false);expect((await f.save()).version).toBe(2)
 })
 it('concurrent Save calls create at most one revision and preserve the original objects',async()=>{
  const f=await seed();await f.edit('summary','Yeni özet');await f.edit('note','Yeni not')
  const results=await Promise.allSettled([f.save(),f.save()]);expect(results.filter(r=>r.status==='fulfilled').length).toBeGreaterThan(0)
  expect(await prisma.reportRevision.count({where:{report:{topicId:f.topicId}}})).toBe(2);expect(await drafts.getOpenDraft(f.topicId)).toBeNull();expect(f.values.get(f.originalHtmlKey)?.toString()).toBe('immutable original html')
  const history=await drafts.getPublishedHistory(f.topicId);expect(history[0]!.edits).toHaveLength(2)
 })
 it('rejects a Save snapshot when a later edit has arrived without treating the report as stale',async()=>{
  const f=await seed();await f.edit('summary','Yeni özet');const before=(await drafts.getOpenDraft(f.topicId))!;await f.edit('note','Sonradan eklenen not')
  await expect(topics.createReportRevision({scanRunId:f.runId,topicId:f.topicId,analysisRevisionId:f.analysis.id,title:'Özet',basename:`01-${f.topicId}.html`,card:'K1',version:2,specObjectKey:`${f.topicId}/attempt.json`,htmlObjectKey:`${f.topicId}/attempt.html`,draftId:before.id,draftSequence:before.edits.at(-1)!.sequence,draftUpdatedAt:before.updatedAt})).rejects.toBeInstanceOf(ReportDraftChangedError)
  expect(await prisma.reportRevision.count({where:{report:{topicId:f.topicId}}})).toBe(1);expect((await drafts.getOpenDraft(f.topicId))?.edits).toHaveLength(2)
 })
})
