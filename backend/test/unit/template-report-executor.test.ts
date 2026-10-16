import { describe,it,expect,vi } from 'vitest'
import { createOperationExecutors } from '../../src/modules/operations/executors'
import { defaultTemplateDefinition } from '../../src/modules/workspace/template-definition'
import { defaultSections } from '../../src/modules/workspace/report-template-catalog'
import { sampleTemplateContent } from '../../src/modules/workspace/template-renderer'
import { publishTopicAnalysis } from '../../src/modules/topic-analysis/application/execute-run-topic-analyses'
import { applyReportPatch } from '../../src/modules/topic-analysis/domain/report-patch'
import { ReportSpecSchema } from '../../src/modules/topic-analysis/domain/report-spec-schemas'
import { renderReportHtml } from '../../src/modules/topic-analysis/application/render-report-html'
const definition=defaultTemplateDefinition()
const content=sampleTemplateContent(definition);content.sections.forEach(s=>{s.evidenceIds=['e1'];s.fields.forEach(f=>{f.text='Gerçek kaynak içeriği'})})
const analysis={schemaVersion:2,title:'Belge',summary:'Kaynak özeti',detailedAnalysis:'Kaynak analizi',changes:[],affectedParties:[],effectiveDates:[],unresolvedReferences:[],evidence:[{id:'e1',documentVersionId:'v1',excerpt:'Kaynak içeriği'}],sourceContext:[{documentVersionId:'v1',title:'Belge',origin:'UPLOAD',url:null,publishedOn:null}]}
describe('structured template report integration',()=>{
 it('uses the frozen definition in BUILD_REPORT and stores the actual rendered result',async()=>{
  const prisma:any={operationTask:{findFirst:vi.fn().mockResolvedValue({artifacts:[{kind:'ANALYSIS',data:analysis}]})},reportTemplate:{findUnique:vi.fn()}}
  const putRunFile=vi.fn(),aiModel={generateStructured:vi.fn().mockResolvedValue({json:content,usage:{inputTokens:1,outputTokens:2},providerRequestId:null})}
  const executors=createOperationExecutors({prisma,objectStore:{putRunFile} as any,aiModel,model:'test',extract:vi.fn()})
  const result=await executors.BUILD_REPORT!({operation:'BUILD_REPORT',mode:'REUSE',documentVersionIds:[],analysisTaskId:'a1',templateId:'t1',executionSnapshot:{template:{revision:8,definition,sections:defaultSections}}} as any,{taskId:'11111111-1111-4111-8111-111111111111',actorScope:'test',signal:new AbortController().signal} as any)
  const data=result[0]!.data as any
  expect(data.templateSnapshot.definition).toEqual(definition);expect(data.templateRevision).toBe(8);expect(data.html).toContain('Gerçek kaynak içeriği');expect(data.html).not.toContain(definition.requirements[0]!.instruction);expect(prisma.reportTemplate.findUnique).not.toHaveBeenCalled();expect(putRunFile).toHaveBeenCalled()
 })
 it('uses section instructions in automation publication and persists the template snapshot',async()=>{
  const topicId='11111111-1111-4111-8111-111111111111'
  const analysis:any={schemaVersion:1,topicId,status:'PASS',document:{title:'Belge',gazetteDate:'2026-10-13',gazetteNumber:'1',sourceUrl:'https://example.com'},change:{type:'NEW_REGULATION',summary:'Özet',detailedAnalysis:'Ayrıntı'},affectedParties:[],effectiveDates:[],comparisons:[],tables:[],officialSources:[{id:'s1',label:'Kaynak',url:'https://example.com',evidenceIds:['e1']}],supportingSources:[],evidence:[{id:'e1',objectKey:'evidence',locator:'Sayfa 1',excerpt:'Kaynak içeriği'}],unresolvedReferences:[],emailTitle:'Belge',emailSummary:'Özet'}
  const repository:any={markTopicRendering:vi.fn(),nextReportVersion:vi.fn().mockResolvedValue(1),markTopicValidating:vi.fn(),createReportRevision:vi.fn().mockResolvedValue({id:'published'})}
  const putRunFile=vi.fn(),aiModel={generateStructured:vi.fn().mockResolvedValue({json:content,usage:{inputTokens:1,outputTokens:2},providerRequestId:null})}
  await publishTopicAnalysis({runId:'run1',targetDate:'2026-10-13',workspaceConfig:{templateId:'t1',template:{definition,revision:9}},indexObjectKey:'',indexSourceUrl:'https://example.com',inspectedDocumentCount:1} as any,{id:'analysis1',version:1,analysisObjectKey:'a',markdownObjectKey:'m',analysis},1,{repository,objectStore:{putRunFile} as any,aiModel,model:'test'})
  const spec=JSON.parse(putRunFile.mock.calls.find(c=>c[0].endsWith('report-spec.json'))![1].toString())
  expect(spec.customization.templateReport.revision).toBe(9);expect(repository.createReportRevision).toHaveBeenCalled()
  const revised=applyReportPatch(ReportSpecSchema.parse(spec),{edits:[{path:'customization.templateReport.content.sections.0.fields.0.text',value:'Düzeltilmiş görünür metin'}]}).spec
  expect(await renderReportHtml(revised)).toContain('Düzeltilmiş görünür metin');expect(await renderReportHtml(spec)).not.toContain('Düzeltilmiş görünür metin')
 })
})
