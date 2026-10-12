import {describe,expect,it} from 'vitest'
import { load } from 'cheerio'
import {defaultSections,sectionComponents,templateHtml,normalizeTemplateSections} from '../../src/modules/workspace/report-template-catalog'
import {applyAutomationTemplate} from '../../src/modules/topic-analysis/application/apply-automation-template'
import {ReportSpecSchema} from '../../src/modules/topic-analysis/domain/report-spec-schemas'
import {renderReportHtml} from '../../src/modules/topic-analysis/application/render-report-html'
const spec=ReportSpecSchema.parse({schemaVersion:1,templateFamily:'bulten-v2',reportId:'111026-01',topicId:'11111111-1111-4111-8111-111111111111',card:'K1',documentTitle:'Gerçek belge',issueNumber:'33380',displayDate:'11 Ekim 2026',typeLabel:'Düzenleme',title:'Gerçek başlık',summary:'Gerçek özet.',affectedParties:['İthalatçılar','İhracatçılar'],dates:['12 Ekim 2026'],note:'Gerçek not.',source:{label:'Resmî Gazete',url:'https://www.resmigazete.gov.tr/belge'},blocks:['B1','B10']})
describe('corporate template catalog',()=>{
 it('contains all six cards and ten bulletin blocks using the real corporate shell',()=>{
  expect(sectionComponents.filter(s=>/^K[1-6]$/.test(s.id))).toHaveLength(6)
  expect(sectionComponents.filter(s=>/^B(?:[1-9]|10) ·/.test(s.heading))).toHaveLength(10)
  expect(templateHtml).toContain('data:image/png;base64,')
  expect(templateHtml).toContain('ATEZ Mevzuat Radarı Günlük Raporu')
  expect(templateHtml).toContain('Yasal uyarı / sorumluluk reddi')
 })
 it('restores fixed classes and headings while accepting only edited slot text',()=>{
  const original=sectionComponents.find(s=>s.id==='summary')!
  const edited=load(original.html,{},false)
  edited('section').attr('class','hacked');edited('h2').text('Yeni kurumsal tasarım')
  edited('[data-template-content]').text('Düzeltilmiş içerik.')
  const result=normalizeTemplateSections([{...original,heading:'Değişmiş etiket',html:edited.html()}])[0]!
  expect(result.heading).toBe(original.heading)
  expect(result.html).toContain('class="block"')
  expect(result.html).not.toContain('hacked')
  expect(result.html).not.toContain('Yeni kurumsal tasarım')
  expect(result.html).toContain('Düzeltilmiş içerik.')
 })
 it('uses report data instead of sample text and includes the logo and legal footer only once',async()=>{
  const edited=applyAutomationTemplate(spec,{templateId:'t1',template:{html:templateHtml,sections:defaultSections}})
  const html=await renderReportHtml(edited)
  expect(html).toContain('Gerçek özet.')
  expect(html).toContain('İhracatçılar')
  expect(html).not.toContain('Mevzuatın kısa özeti burada')
  expect(load(html)('img.logo')).toHaveLength(1)
  expect(load(html)('footer.footer')).toHaveLength(1)
  expect(load(html)('.source')).toHaveLength(1)
 })
 it('retains deliberate content changes during automation rendering',()=>{
  const original=sectionComponents.find(s=>s.id==='summary')!
  const $=load(original.html,{},false);$('[data-template-content]').text('Editörün metni.')
  const result=applyAutomationTemplate(spec,{template:{html:templateHtml,sections:[{...original,html:$.html()}]}})
  expect(result.customization?.customHtml).toContain('Editörün metni.')
 })
})
