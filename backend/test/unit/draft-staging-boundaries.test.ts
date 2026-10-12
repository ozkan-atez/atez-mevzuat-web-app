import {describe,it,expect,vi} from 'vitest'
import {executeTopicRevision} from '../../src/modules/topic-analysis/application/execute-topic-revision'
import {stageAnalysisInDraft} from '../../src/modules/topic-analysis/application/stage-analysis-in-draft'
import {publishReportDraft} from '../../src/modules/topic-analysis/application/publish-report-draft'
import {ReportDraftBusyError} from '../../src/modules/topic-analysis/application/apply-report-field-edits'
import {ReportSpecSchema,type ReportSpec} from '../../src/modules/topic-analysis/domain/report-spec-schemas'
import type {ReportDraftRepository} from '../../src/modules/topic-analysis/application/ports'
const topicId='11111111-1111-4111-8111-111111111111'
const spec=ReportSpecSchema.parse({schemaVersion:1,templateFamily:'bulten-v2',reportId:'111026-01',topicId,card:'K1',documentTitle:'Belge',issueNumber:'33380',displayDate:'11 Ekim 2026',typeLabel:'Düzenleme',title:'Orijinal başlık',summary:'Orijinal özet',affectedParties:[],dates:[],note:null,source:{label:'Resmî Gazete',url:'https://www.resmigazete.gov.tr/current'},blocks:['B1','B2','B3','B10']}) as Extract<ReportSpec,{card:'K1'}>
const base={runId:'run',targetDate:'2026-10-11',version:1,analysisRevisionId:'analysis',basename:'r.html',specObjectKey:'original.json'}
const fixture=()=>{
 let draft:any={id:'draft1',topicId,baseVersion:1,analysisRevisionId:null,spec:{...spec,title:'Önceki elle düzenleme'},status:'OPEN',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),edits:[{sequence:1,path:'title',nextValue:'Önceki elle düzenleme'}]}
 const keyed=new Map<string,any>()
 const repo:any={getPublishedBase:vi.fn(async()=>base),getOpenDraft:vi.fn(async()=>draft.status==='OPEN'?draft:null),findDraftByRequestKey:vi.fn(async(key:string)=>keyed.get(key) ?? null),openDraft:vi.fn(),appendEdits:vi.fn(async(input:any)=>{draft={...draft,spec:input.spec,analysisRevisionId:input.analysisRevisionId ?? draft.analysisRevisionId,edits:[...draft.edits,...input.edits]};if(input.requestKey)keyed.set(input.requestKey,draft);return draft}),setDraftAnalysisRevision:vi.fn(),closeDraft:vi.fn()}
 const store={getContent:vi.fn(async(key:string)=>Buffer.from(key==='original.json'?JSON.stringify(spec):'{}')),putRunFile:vi.fn()}
 return{repo,store,getDraft:()=>draft,close:()=>{draft.status='PUBLISHED'}}
}
describe('report prompt correction stays in the draft until Save',()=>{
 it('uses the current draft for publication prompts and never creates a report revision',async()=>{
  const f=fixture(),work={topicId,runId:'run',message:{id:'message',content:'Özeti düzelt',revisionKind:'PUBLICATION'},latestReport:{specObjectKey:'original.json',basename:'r.html',version:1},latestAnalysis:{id:'analysis',analysisObjectKey:'analysis.json'},requestAnalysis:null,requestReport:null}
  const repository:any={getTopicRevisionWorkItem:vi.fn(async()=>work),startTopicAiExecution:vi.fn(async()=>({id:'ai1'})),completeTopicAiExecution:vi.fn(),appendRevisionResult:vi.fn(),markTopicCompleted:vi.fn(),createReportRevision:vi.fn()}
  const model={generateStructured:vi.fn(async(_request:any)=>({json:{...spec,title:'Önceki elle düzenleme',summary:'Yeni AI özeti'},providerRequestId:'fake',usage:{inputTokens:1,outputTokens:1}}))}
  const deps:any={repository,draftRepository:f.repo,objectStore:f.store,aiModel:model,model:'fake',maxContextBytes:1000}
  await executeTopicRevision({topicId,messageId:'message'},deps)
  expect(JSON.stringify(model.generateStructured.mock.calls[0]![0].parts)).toContain('Önceki elle düzenleme')
  expect(f.getDraft().spec.title).toBe('Önceki elle düzenleme');expect(f.getDraft().spec.summary).toBe('Yeni AI özeti');expect(f.getDraft().edits).toHaveLength(2);expect(repository.createReportRevision).not.toHaveBeenCalled();expect(f.store.putRunFile).not.toHaveBeenCalled()
  await executeTopicRevision({topicId,messageId:'message'},deps);f.close();await executeTopicRevision({topicId,messageId:'message'},deps)
  expect(model.generateStructured).toHaveBeenCalledTimes(1);expect(f.repo.openDraft).not.toHaveBeenCalled()
 })
 it('stages only new analysis differences while preserving an earlier unrelated manual title',async()=>{
  const f=fixture()
  await stageAnalysisInDraft({topicId,spec:{...spec,summary:'Kanıtlı yeni özet'},previousSpec:spec,analysisRevisionId:'analysis2',prompt:'Etkiyi analiz et',chatMessageId:'analysis-message'},{repository:f.repo as ReportDraftRepository,objectStore:f.store})
  expect(f.getDraft().spec.title).toBe('Önceki elle düzenleme');expect(f.getDraft().spec.summary).toBe('Kanıtlı yeni özet');expect(f.getDraft().analysisRevisionId).toBe('analysis2');expect(f.repo.appendEdits).toHaveBeenCalledWith(expect.objectContaining({analysisRevisionId:'analysis2',edits:[expect.objectContaining({path:'summary'})]}))
 })
 it('rejects Save while a durable prompt request is pending before writing any objects',async()=>{
  const f=fixture(),writer={createReportRevision:vi.fn(),hasPendingReportRevisionWork:vi.fn(async()=>true)}
  await expect(publishReportDraft({topicId,expectedVersion:1},{repository:f.repo as ReportDraftRepository,topicRepository:writer,objectStore:f.store as any})).rejects.toBeInstanceOf(ReportDraftBusyError)
  expect(writer.createReportRevision).not.toHaveBeenCalled();expect(f.store.putRunFile).not.toHaveBeenCalled();expect(f.repo.closeDraft).not.toHaveBeenCalled()
 })
})
