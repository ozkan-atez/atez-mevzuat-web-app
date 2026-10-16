import {describe,it,expect,vi} from 'vitest'
import Fastify from 'fastify'
import {reportChatIntent} from '../../src/modules/topic-analysis/application/report-chat-intent'
import {topicAnalysisRoutes} from '../../src/modules/topic-analysis/topic-analysis.routes'
import {operationReportSpec,readReportSpec} from '../../src/modules/operations/report-spec'
import {renderReportHtml} from '../../src/modules/topic-analysis/application/render-report-html'
import {executeTopicRevision} from '../../src/modules/topic-analysis/application/execute-topic-revision'
const id='11111111-1111-4111-8111-111111111111'
describe('shared report workflow',()=>{
 it.each([
 ['Yaptığın analizi benimle paylaş','SHOW_ANALYSIS'],
 ['Analizi tekrar göster','SHOW_ANALYSIS'],
 ['Analizi tekrar yap','RERUN_ANALYSIS'],
 ['Yeniden analiz et','RERUN_ANALYSIS'],
 ['Analizi yenile','RERUN_ANALYSIS'],
 ['Analizi tekrar yapma, özeti kısalt','EDIT_REPORT'],
 ['Yeni analizi rapora uygula','EDIT_REPORT'],
 ['Başlığı değiştir','EDIT_REPORT'],
 ])('%s resolves to %s',(text,expected)=>expect(reportChatIntent(text)).toBe(expected))
 it('adapts historical source reports to editable template HTML without inventing URLs',async()=>{
  const raw={analysisTaskId:id,reportContent:{title:'Duyuru',summary:'Kaynak özeti',detailedAnalysis:'Kanıtlı açıklama'},sourceContext:[{title:'Yüklenen belge',url:null}],affectedParties:[],effectiveDates:[]}
  const spec=readReportSpec(raw,new Date('2026-10-08T12:00:00Z'))
  expect(spec.displayDate).toBe('08.10.2026');expect(spec.source.url).toBe('');expect(spec.card).toBe('K5')
  expect(await renderReportHtml(spec)).toContain('data-field="summary"')
  expect(operationReportSpec({reportSpec:spec},id)).toEqual(spec)
 })
 it.each(['SHOW_ANALYSIS','RERUN_ANALYSIS'] as const)('%s uses the analysis service without generating a report draft',async intent=>{
  const app=Fastify(),repository={getTopicDetail:vi.fn(async()=>({documentId:'',reportCard:'K5'})),recordRunReportMessage:vi.fn(),appendRevisionRequest:vi.fn()},reportAnalysis={read:vi.fn(async()=>({text:'Kayıtlı analiz'})),rerun:vi.fn()},draftRepository={getPublishedBase:vi.fn(),openDraft:vi.fn()}
  await app.register(topicAnalysisRoutes,{repository:repository as any,reportAnalysis:reportAnalysis as any,draftRepository:draftRepository as any})
  const response=await app.inject({method:'POST',url:`/${id}/messages`,headers:{'idempotency-key':id},payload:{message:intent==='SHOW_ANALYSIS'?'Analizi paylaş':'Analizi tekrar yap'}})
  expect(response.statusCode).toBe(200)
  expect(reportAnalysis.rerun).toHaveBeenCalledTimes(intent==='SHOW_ANALYSIS'?0:1)
  expect(repository.appendRevisionRequest).not.toHaveBeenCalled();expect(draftRepository.openDraft).not.toHaveBeenCalled();expect(draftRepository.getPublishedBase).not.toHaveBeenCalled()
  expect(repository.recordRunReportMessage).toHaveBeenLastCalledWith(id,expect.objectContaining({role:'ASSISTANT',content:intent==='SHOW_ANALYSIS'?'Kayıtlı analiz':expect.stringContaining('değiştirilmedi')}))
  await app.close()
 })
 it('replaying a completed analysis does not stage or publish a report',async()=>{
  const repository={getTopicRevisionWorkItem:vi.fn(async()=>({topicId:id,message:{id:'m',revisionKind:'ANALYSIS'},requestReport:null,requestAnalysis:{version:2}})),markTopicCompleted:vi.fn(),appendRevisionResult:vi.fn()}
  const draftRepository={openDraft:vi.fn(),appendEdits:vi.fn()},aiModel={generateStructured:vi.fn()},objectStore={getContent:vi.fn(),putRunFile:vi.fn()}
  await executeTopicRevision({topicId:id,messageId:'m'},{repository,draftRepository,aiModel,objectStore} as any)
  expect(draftRepository.openDraft).not.toHaveBeenCalled();expect(draftRepository.appendEdits).not.toHaveBeenCalled();expect(aiModel.generateStructured).not.toHaveBeenCalled();expect(objectStore.putRunFile).not.toHaveBeenCalled()
  expect(repository.appendRevisionResult).toHaveBeenCalledWith(id,expect.objectContaining({content:expect.stringContaining('değiştirilmedi')}))
 })
})

it('reruns source analysis through the common analyzer and persists only an analysis task',async()=>{
 const {ReportAnalysisService}=await import('../../src/modules/operations/report-analysis-service')
 const evidence={id:'source1',title:'Duyuru',url:'https://example.com/duyuru',text:'Kaynak metni.',publishedOn:null}
 const analysis={schemaVersion:2,title:'Duyuru',summary:'Yeni analiz özeti',detailedAnalysis:'Kaynak açıklaması',changes:[],affectedParties:[],effectiveDates:[],unresolvedReferences:[],evidence:[{id:'e1',documentVersionId:'source1',excerpt:'Kaynak metni.'}]}
 const task={id:'analysis1',artifacts:[{kind:'ANALYSIS',data:{...analysis,sourceEvidence:[evidence],sourceContext:[]}}]}
 const tx={operationTask:{update:vi.fn()},operationRequest:{update:vi.fn()}}
 const prisma:any={
  topicReport:{findFirst:vi.fn(async()=>({id,topic:null,actorScope:'local-workspace',operationTask:{artifacts:[{kind:'REPORT_DRAFT',data:{analysisTaskId:'analysis1'}}]}}))},
  operationTask:{findFirst:vi.fn(async()=>null),findUnique:vi.fn(async()=>task),update:vi.fn()},
  operationRequest:{findUnique:vi.fn(async()=>null),create:vi.fn(async()=>({id:'request1'})),update:vi.fn()},
  $transaction:vi.fn(async(fn:any)=>fn(tx)),
  reportDraft:{create:vi.fn(),update:vi.fn()},reportRevision:{create:vi.fn()}
 }

 const model={generateStructured:vi.fn(async()=>({json:analysis,usage:{inputTokens:1,outputTokens:2},providerRequestId:null}))}
 await new ReportAnalysisService(prisma,{getContent:vi.fn()},model,'test').rerun(id,'Analizi tekrar yap',id)
 expect(model.generateStructured).toHaveBeenCalledTimes(1)
 expect(tx.operationTask.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'SUCCEEDED',artifacts:{create:{kind:'ANALYSIS',data:expect.objectContaining({summary:'Yeni analiz özeti'})}}})}))
 expect(prisma.reportDraft.create).not.toHaveBeenCalled();expect(prisma.reportDraft.update).not.toHaveBeenCalled();expect(prisma.reportRevision.create).not.toHaveBeenCalled()
})
