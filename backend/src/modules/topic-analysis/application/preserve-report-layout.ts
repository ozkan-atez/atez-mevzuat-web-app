import { isDeepStrictEqual } from 'node:util'
import { load } from 'cheerio'
import type { ReportSpec } from '../domain/report-spec-schemas'
import { ReportPatchError } from '../domain/report-patch'
function htmlStructure(html:string|null|undefined) {
  if(!html)return html
  const $=load(html)
  // Text is editable; element order, styles, classes and other attributes are layout.
  $('*').contents().filter((_i,node)=>node.type==='text').remove()
  return $.html()
}
function layout(spec:ReportSpec) {
  const c=spec.customization,t=c?.templateReport
  return {blocks:spec.blocks,templateId:c?.templateId,order:c?.order,headings:c?.headings,
    customHtml:htmlStructure(c?.customHtml),sections:c?.sections.map(s=>({...s,html:htmlStructure(s.html)})),
    definition:t?.definition,revision:t?.revision,sources:t?.sources,
    fields:t?.content.sections.map(s=>({requirementId:s.requirementId,componentId:s.componentId,status:s.status,evidenceIds:s.evidenceIds,fields:s.fields.map(f=>({key:f.key,items:f.items.length,columns:f.columns,rows:f.rows.map(r=>r.length)}))}))}
}
export function assertReportLayoutPreserved(before:ReportSpec,after:ReportSpec) {
  if(!isDeepStrictEqual(layout(before),layout(after)))throw new ReportPatchError('LOCKED_PATH','İçerik düzeltmesi raporun şablonunu veya bölüm yapısını değiştiremez. Mevcut alanları düzenleyin; tasarım değişikliğini Şablonlar ekranından yapın.')
}
