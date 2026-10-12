import {describe,expect,it} from 'vitest'
import {ReportCustomizationSchema,ReportSpecSchema} from '../../src/modules/topic-analysis/domain/report-spec-schemas'
import {applyReportPatch} from '../../src/modules/topic-analysis/domain/report-patch'
import {renderReportHtml} from '../../src/modules/topic-analysis/application/render-report-html'
import {validateReportHtml} from '../../src/modules/topic-analysis/application/validate-report-html'
import {buildPatchPromptParts} from '../../src/modules/topic-analysis/application/patch-prompts'
import {applyAutomationTemplate} from '../../src/modules/topic-analysis/application/apply-automation-template'

const spec = ReportSpecSchema.parse({schemaVersion:1,templateFamily:'bulten-v2',reportId:'051026-01',topicId:'11111111-1111-4111-8111-111111111111',card:'K1',documentTitle:'İthalat Tebliği',issueNumber:'33000',displayDate:'5 Ekim 2026',typeLabel:'Değişiklik',title:'İthalat Tebliği',summary:'Yeni oran uygulanır.',affectedParties:['İthalatçılar'],dates:['5 Ekim 2026'],note:'İşlem belgelerini inceleyin.',source:{label:'Resmî Gazete',url:'https://www.resmigazete.gov.tr/doc'},blocks:['B1','B10']})
const expectation = {customized:true,card:'K1' as const,topicId:spec.topicId,basename:'01-ithalat.html'}
const source = {id:'added',label:'Bakanlık açıklaması',url:'https://ticaret.gov.tr/aciklama',content:'Ek kanıt: yürürlük 6 Ekim 2026.',kind:'TEXT' as const}

describe('report workspace',()=>{
  it('keeps legacy reports unchanged and permits reverting a first customization',()=>{
    const edited = applyReportPatch(spec,{edits:[{path:'customization',value:ReportCustomizationSchema.parse({headings:{summary:'Özet'}})}]})
    expect(edited.applied[0]?.previousValue).toBeNull()
    const reverted = applyReportPatch(edited.spec,{edits:[{path:'customization',value:null}]})
    expect(reverted.spec.customization).toBeNull()
    expect(reverted.spec.reportId).toBe(spec.reportId)
  })
  it('reorders sections, changes headings, lists extra evidence and remains publishable',async()=>{
    const edited = ReportSpecSchema.parse({...spec,customization:{headings:{summary:'Yönetici Özeti'},order:['custom:extra','dates','summary'],sections:[{id:'extra',title:'Ek açıklama',html:'<p>Kaynağa dayanan ek açıklama.</p>'}],sources:[source]}})
    const html = await renderReportHtml(edited)
    expect(html.indexOf('Ek açıklama')).toBeLessThan(html.indexOf('Yönetici Özeti'))
    expect(html).toContain('Bakanlık açıklaması')
    expect(()=>validateReportHtml(html,expectation)).not.toThrow()
    expect(buildPatchPromptParts({spec:edited,request:'Ek kanıtı rapora ekle'}).map(part=>part.text).join('')).toContain(source.content)
  })
  it('sanitizes active content and unsafe URLs before rendering raw edited HTML',async()=>{
    const edited = ReportSpecSchema.parse({...spec,customization:{customHtml:'<script>alert(1)</script><iframe src="https://evil.test"></iframe><p onclick="alert(2)" style="color:red">Metin <a href="javascript:alert(3)">bağlantı</a></p><img src="https://evil.test">',sources:[source]}})
    const html = await renderReportHtml(edited)
    expect(html).not.toMatch(/<script|<iframe|onclick=|javascript:|evil.test/)
    expect(html).toContain('Metin')
    expect(html).toContain('data-field="customization.customHtml"')
    expect(html).toContain('Bakanlık açıklaması')
    expect(()=>validateReportHtml(html,expectation)).not.toThrow()
  })
  it('applies a frozen automation template and resolves its placeholders',async()=>{
    const edited = applyAutomationTemplate(spec,{templateId:'template-1',template:{html:'<!DOCTYPE html><html><head><style>body{color:red}</style></head><body><div style="display:grid;gap:24px;position:fixed;background-image:url(https://evil.test)"><h1>{{title}}</h1><p>{{date}}</p>{{sections}}</div></body></html>',sections:[{id:'summary-copy',heading:'Özel Özet',html:'<section data-section="summary"><h2>{{heading}}</h2><div>{{content}}</div></section>',enabled:true},{id:'impact',heading:'Gizli',html:'<p>Gizli</p>',enabled:false}]}})
    const html = await renderReportHtml(edited)
    expect(html).toContain('data-field="customization.customHtml"')
    expect(edited.customization?.templateId).toBe('template-1')
    expect(html).toContain('Özel Özet')
    expect(html).toContain('Yeni oran uygulanır.')
    expect(html).toContain('style="display: grid; gap: 24px"')
    expect(html).not.toContain('position:fixed')
    expect(html).not.toContain('https://evil.test')
    expect(html).not.toContain('{{')
    expect(html).not.toContain('<p>Gizli</p>')
    expect(()=>validateReportHtml(html,expectation)).not.toThrow()
  })
  it('applies direct rich HTML edits to a rendered template and sanitizes them',async()=>{
    const templated = ReportSpecSchema.parse({...spec,customization:{customHtml:'<section><h2>Başlık</h2><p>Metin</p></section>'}})
    const edited = applyReportPatch(templated,{edits:[{path:'customization.customHtml',value:'<h2>Düzeltilmiş başlık</h2><p><strong>Yeni metin</strong></p><script>alert(1)</script>'}]})
    const html = await renderReportHtml(edited.spec)
    expect(html).toContain('<strong>Yeni metin</strong>')
    expect(html).toContain('data-field="customization.customHtml"')
    expect(html).not.toContain('<script')
    expect(()=>validateReportHtml(html,expectation)).not.toThrow()
    const reverted = applyReportPatch(edited.spec,{edits:[{path:'customization.customHtml',value:edited.applied[0]!.previousValue}]})
    expect(reverted.spec.customization?.customHtml).toContain('Başlık')
  })
  it('rejects ambiguous source ids and non-http provenance',()=>{
    expect(ReportCustomizationSchema.safeParse({sources:[source,source]}).success).toBe(false)
    expect(ReportCustomizationSchema.safeParse({sources:[{...source,url:'javascript:alert(1)'}]}).success).toBe(false)
  })
})
