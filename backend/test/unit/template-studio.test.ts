import { describe,it,expect,vi } from 'vitest'
import { load } from 'cheerio'
import { defaultTemplateDefinition,TemplateDefinitionSchema } from '../../src/modules/workspace/template-definition'
import { renderTemplateReport,sampleTemplateContent } from '../../src/modules/workspace/template-renderer'
import { generateTemplateReport,suggestTemplate } from '../../src/modules/workspace/template-ai'
import { ReportSpecSchema } from '../../src/modules/topic-analysis/domain/report-spec-schemas'
import { renderReportHtml } from '../../src/modules/topic-analysis/application/render-report-html'
import { validateReportHtml } from '../../src/modules/topic-analysis/application/validate-report-html'
const sources=[{id:'e1',label:'Gerçek kaynak',url:'https://example.com',excerpt:'Kaynak alıntısı.'}]
const model=(json:unknown)=>({generateStructured:vi.fn().mockResolvedValue({json,usage:{inputTokens:10,outputTokens:20},providerRequestId:null})})
const validContent=()=>{const content=sampleTemplateContent(defaultTemplateDefinition());content.sections.forEach(s=>s.evidenceIds=['e1']);return content}
describe('template studio contract and rendering',()=>{
 it('keeps content requirements separate from printed text and preserves custom titles and appearance',()=>{
  const d=defaultTemplateDefinition();d.requirements[0]!.instruction='GİZLİ ÜRETİM TALİMATI';d.layout[0]!.title='Karar özeti';d.theme.accent='#123456';d.shell.showLogo=false;d.shell.footer='Özel alt bilgi'
  const html=renderTemplateReport({definition:d,content:sampleTemplateContent(d),sources:[],revision:2},{title:'Rapor',reportId:'1',date:'13 Ekim'})
  expect(html).not.toContain('GİZLİ ÜRETİM TALİMATI');expect(html).toContain('Karar özeti');expect(html).toContain('#123456');expect(html).toContain('Özel alt bilgi');expect(load(html)('img.logo')).toHaveLength(0)
 })
 it('rejects dangling bindings, duplicate ids, omitted mandatory sections and hidden enabled requirements',()=>{
  const d=defaultTemplateDefinition();d.layout[0]!.requirementId='missing';expect(TemplateDefinitionSchema.safeParse(d).success).toBe(false)
  const duplicate=defaultTemplateDefinition();duplicate.components.push(duplicate.components[0]!);expect(TemplateDefinitionSchema.safeParse(duplicate).success).toBe(false)
  const missing=defaultTemplateDefinition();missing.requirements[0]!.missing='OMIT';expect(TemplateDefinitionSchema.safeParse(missing).success).toBe(false)
  const hidden=defaultTemplateDefinition();hidden.layout[0]!.enabled=false;expect(TemplateDefinitionSchema.safeParse(hidden).success).toBe(false)
 })
 it('escapes source, fixed and generated content without allowing script or remote assets',()=>{
  const d=defaultTemplateDefinition();d.layout[0]!.title='<img src=x onerror=alert(1)>';const content=validContent();content.sections[0]!.fields[0]!.text='<script>alert(1)</script>'
  const html=renderTemplateReport({definition:d,content,sources:[{...sources[0]!,url:'javascript:alert(1)'}],revision:1},{title:'Report',reportId:'1',date:''})
  const $=load(html);expect($('script')).toHaveLength(0);expect($('img[src=x]')).toHaveLength(0);expect($('a[href^="javascript:"]')).toHaveLength(0);expect(html).toContain('&lt;script&gt;')
 })
 it('renders frozen structured content through the actual published report path',async()=>{
  const d=defaultTemplateDefinition();d.shell.showHeader=false;d.shell.showFooter=false
  const spec=ReportSpecSchema.parse({schemaVersion:1,templateFamily:'bulten-v2',card:'K1',reportId:'131026-01',topicId:'11111111-1111-4111-8111-111111111111',documentTitle:'Kaynaklı rapor',title:'Kaynaklı rapor',issueNumber:'1',displayDate:'13 Ekim',typeLabel:'Düzenleme',summary:'Özet',affectedParties:[],dates:[],note:null,source:{label:'Kaynak',url:'https://example.com'},blocks:['B1'],customization:{templateReport:{definition:d,content:validContent(),sources,revision:4}}})
  const html=await renderReportHtml(spec);expect(html).toContain('Yönetici özeti');expect(html).toContain('Kaynak alıntısı.');expect(()=>validateReportHtml(html,{card:'K1',topicId:spec.topicId,basename:'01-topic.html',structuredTemplate:true})).not.toThrow()
 })
})
describe('template AI generation',()=>{
 it('sends real requirements, accepts evidenced sections and pins the template revision',async()=>{
  const ai=model(validContent()),d=defaultTemplateDefinition();d.requirements[0]!.instruction='Yalnız lojistik maliyetlerini açıkla.'
  const result=await generateTemplateReport({definition:d,revision:7,sources,evidence:{summary:'Kaynak'},model:ai,modelName:'test'})
  expect(ai.generateStructured.mock.calls[0]![0].parts[0].text).toContain('Yalnız lojistik maliyetlerini açıkla.');expect(result.report.revision).toBe(7)
 })
 it('plans sections from the brief and chooses only relevant pool components',async()=>{
  const d=defaultTemplateDefinition();d.brief='Sadece lojistik etkisini ve önerileri açıkla.'
  const requirement={...d.requirements[0]!,id:'logistics',heading:'Lojistik etkisi',instruction:'Lojistik etkilerini açıkla.'}
  const section={...validContent().sections[0]!,requirementId:'logistics',componentId:'text'}
  const ai=model({requirements:[requirement],sections:[section]})
  const result=await generateTemplateReport({definition:d,revision:8,sources,evidence:{},model:ai,modelName:'test'})
  expect(result.report.definition.requirements).toEqual([requirement]);expect(result.report.definition.layout).toHaveLength(1)
  expect(result.report.definition.components).toEqual(d.components);expect(d.requirements).toHaveLength(5)
  expect(ai.generateStructured.mock.calls[0]![0].parts[0].text).toContain(d.brief)
  const html=renderTemplateReport(result.report,{title:'Rapor',reportId:'1',date:''})
  expect(html).toContain('Lojistik etkisi');expect(html).not.toContain(d.brief);expect(html).not.toContain('GTİP karşılaştırması')
  await expect(generateTemplateReport({definition:d,revision:8,sources,evidence:{},model:model({requirements:[requirement],sections:[{...section,componentId:'unknown'}]}),modelName:'test'})).rejects.toThrow('kitaplık dışında')
 })
 it('rejects fabricated citations and incomplete responses',async()=>{
  const content=validContent();content.sections[0]!.evidenceIds=['fabricated']
  const input={definition:defaultTemplateDefinition(),revision:1,sources,evidence:{},modelName:'test'}
  await expect(generateTemplateReport({...input,model:model(content)})).rejects.toThrow('tanımsız kaynak')
  await expect(generateTemplateReport({...input,model:model({sections:[]})})).rejects.toThrow('tüm içerik')
 })
 it('blocks critical missing evidence, permits trial inspection and distinguishes not applicable',async()=>{
  const d=defaultTemplateDefinition();d.requirements[0]!.missing='BLOCK';const content=validContent();content.sections[0]={...content.sections[0]!,status:'MISSING',explanation:'Kaynak eksik',fields:[],evidenceIds:[]}
  const input={definition:d,revision:1,sources,evidence:{},modelName:'test',model:model(content)}
  await expect(generateTemplateReport(input)).rejects.toThrow('inceleme gerektiriyor')
  const trial=await generateTemplateReport({...input,allowBlocked:true});expect(trial.issues[0]?.blocking).toBe(true)
  content.sections[0]!.status='NOT_APPLICABLE';const result=await generateTemplateReport({...input,model:model(content)});expect(result.issues).toEqual([])
 })
 it('prevents a design request from rewriting instructions and supports reusable components',async()=>{
  const d=defaultTemplateDefinition(),edited=structuredClone(d);edited.requirements[0]!.instruction='Değişmiş talimat'
  await expect(suggestTemplate(model(edited),'test',d,'DESIGN','Başlığı büyüt')).rejects.toThrow('içerik gereksinimlerini')
  const component={id:'rate-card',name:'Oran kartı',description:'Oran farkı',nodes:[{id:'old',type:'paragraph',field:'old_rate',label:'Önceki oran',text:''},{id:'new',type:'paragraph',field:'new_rate',label:'Yeni oran',text:''}]}
  const result=await suggestTemplate(model(component),'test',d,'COMPONENT','Oran kartı oluştur');expect(result.definition.components.at(-1)).toEqual(component);expect(result.definition.requirements).toEqual(d.requirements)
 })
})
