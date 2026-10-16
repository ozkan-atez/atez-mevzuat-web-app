import { load } from 'cheerio'
import { BULLETIN_V2_LOGO, renderPageSkeleton } from '../topic-analysis/templates/bulten-v2'
import { sanitizeReportStyle } from '../topic-analysis/domain/sanitize-report-fragment'
import type { TemplateContent, TemplateDefinition, TemplateReport } from './template-definition'

export const escapeTemplateText = (value: string) => value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const esc = escapeTemplateText
export function sampleTemplateContent(definition:TemplateDefinition):TemplateContent {
  return {sections:definition.requirements.filter(r=>r.enabled).map(r=>({requirementId:r.id,componentId:definition.layout.find(p=>p.requirementId===r.id && p.componentId!=='auto')?.componentId ?? definition.components[0]!.id,status:'READY',explanation:'',evidenceIds:[],fields:[...new Set(definition.components.flatMap(c=>c.nodes.map(n=>n.field)))].map(key=>({key,text:'Örnek içerik — gerçek rapor üretildiğinde bu alan kaynaklara göre doldurulur.',items:['Örnek birinci madde','Örnek ikinci madde'],columns:['Önceki','Yeni'],rows:[['Örnek değer','Örnek değer']]}))}))}
}
export function templateIssues(definition:TemplateDefinition, content:TemplateContent) {
  return definition.requirements.filter(r=>r.enabled).flatMap(r=>{
    const section=content.sections.find(s=>s.requirementId===r.id)
    if(!section || section.status==='MISSING')return [{requirementId:r.id,heading:r.heading,message:section?.explanation || 'Gerekli kaynak bilgisi eksik.',blocking:r.missing==='BLOCK'}]
    return []
  })
}
export function renderTemplateReport(report:TemplateReport, metadata:{title:string;reportId:string;date:string;issueNumber?:string;topicId?:string}, preview=false):string {
  const {definition:d,content}=report
  const sections=d.layout.filter(p=>p.enabled).map(p=>{
    const r=d.requirements.find(r=>r.id===p.requirementId)
    if(r && !r.enabled)return ''
    const section=content.sections.find(s=>s.requirementId===p.requirementId)
    if(r && section?.status==='MISSING' && r.missing==='OMIT' && !r.required)return ''
    const component=d.components.find(c=>c.id===(p.componentId==='auto'?section?.componentId:p.componentId)) ?? d.components[0]!
    let body=''
    if(r && (!section || section.status!=='READY')) body=`<p>${esc(section?.explanation || 'Bu bölüm için kaynak bilgisi eksik.')}</p>`
    else if(!r) body=`<p>${esc(p.staticText).replaceAll('\n','<br>')}</p>`
    else body=component.nodes.map(node=>{
      const field=section?.fields.find(f=>f.key===node.field)
      const text=node.text || field?.text || ''
      const path=`customization.templateReport.content.sections.${content.sections.indexOf(section!)}.fields.${section?.fields.indexOf(field!)}`
      const marker=(suffix:string)=>!preview && field && !node.text ? ` data-field="${path}.${suffix}"` : ''
      const label=node.label?`<h3>${esc(node.label)}</h3>`:''
      if(node.type==='divider')return '<hr>'
      if(node.type==='heading')return `<h3>${esc(node.text || node.label || text)}</h3>`
      if(node.type==='list')return `${label}${text?`<p${marker('text')}>${esc(text)}</p>`:''}<ul>${(field?.items ?? []).map((i,index)=>`<li${marker(`items.${index}`)}>${esc(i)}</li>`).join('')}</ul>`
      if(['table','comparison','timeline'].includes(node.type))return `${label}${text?`<p${marker('text')}>${esc(text)}</p>`:''}${field?.columns.length?`<div class="table-scroll"><table class="data-table"><thead><tr>${field.columns.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${field.rows.map((row,rowIndex)=>`<tr>${row.map((c,colIndex)=>`<td${marker(`rows.${rowIndex}.${colIndex}`)}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:''}`
      return `${label}<${node.type==='notice'?'aside':'div'}${node.type==='notice'?' class="note"':''}><p${marker('text')}>${esc(text).replaceAll('\n','<br>')}</p></${node.type==='notice'?'aside':'div'}>`
    }).join('')
    const refs=(section?.evidenceIds ?? []).map(id=>report.sources.find(s=>s.id===id)).filter(s=>!!s)
    const citations=refs.length?`<div class="source">${refs.map(s=>`<p>${s.url && /^https?:\/\//i.test(s.url)?`<a href="${esc(s.url)}" rel="noreferrer">${esc(s.label)}</a>`:esc(s.label)}${s.excerpt?` — ${esc(s.excerpt.slice(0,600))}${s.excerpt.length>600?'…':''}`:''}</p>`).join('')}</div>`:''
    const style=sanitizeReportStyle(`padding: ${d.theme.spacing}px; margin-bottom: ${d.theme.spacing}px; border: 1px solid ${d.theme.accent}; background-color: ${p.tone==='warning'?'#fff4d6':p.tone==='info'?'#f1edff':d.theme.background}`)
    return `<section${preview?` data-template-placement="${esc(p.id)}"`: ""} class="block" style="${style}"><h2>${esc(p.title || r?.heading || component.name)}</h2><div style="${sanitizeReportStyle(`display: grid; grid-template-columns: ${p.columns===2?'1fr 1fr':'1fr'}; gap: ${d.theme.spacing}px`)}">${body}</div>${citations}</section>`
  }).join('')
  const html=renderPageSkeleton({topicId:metadata.topicId ?? 'template',documentTitle:esc(metadata.title),reportId:esc(metadata.reportId),issueNumber:esc(metadata.issueNumber ?? ''),displayDate:esc(metadata.date),sourceLabel:'Kaynak bilgileri ilgili bölümlerde belirtilmiştir.',cardHtml:`<article class="card">${preview?'<p class="note">Tasarım önizlemesi · Örnek içerik</p>':''}${sections}</article>`,logoDataUri:BULLETIN_V2_LOGO})
  const $=load(html)
  $('.report-title').text(d.shell.heading || metadata.title)
  if(!d.shell.showLogo)$('img.logo').remove()
  if(!d.shell.showHeader)$('.header').remove()
  if(!d.shell.showFooter)$('footer.footer,.fine').remove()
  else if(d.shell.footer)$('footer.footer').empty().append(`<p>${esc(d.shell.footer).replaceAll('\n','<br>')}</p>`)
  $('.block p,.block li,.data-table').attr('style',sanitizeReportStyle(`font-size: ${d.theme.fontSize}px`))
  $('.block h2').attr('style',sanitizeReportStyle(`color: ${d.theme.accent}; font-size: ${d.theme.fontSize+2}px`))
  $('.feed').attr('style',sanitizeReportStyle(`font-size: ${d.theme.fontSize}px; background-color: ${d.theme.background}`))
  return $.html()
}

/** Render the actual report block in isolation, using the same HTML and styles as publication. */
export function renderTemplateComponent(definition:TemplateDefinition,componentId:string):string {
  const component=definition.components.find(c=>c.id===componentId)
  if(!component)throw new Error('Bileşen bulunamadı.')
  const requirement={...definition.requirements[0]!,id:'component-preview',heading:component.name,enabled:true}
  const isolated:TemplateDefinition={...definition,requirements:[requirement],layout:[{id:'component-preview',requirementId:requirement.id,componentId,enabled:true,title:component.name,staticText:'',columns:1,tone:'plain'}]}
  const $=load(renderTemplateReport({definition:isolated,content:sampleTemplateContent(isolated),sources:[],revision:null},{title:component.name,reportId:'Örnek',date:''},true))
  const block=$('.block').first().toString()
  $('body').empty().append(`<main class="component-example">${block}</main>`)
  $('head').append('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:;"><style>html,body{margin:0!important;padding:0!important;min-width:0!important;background:#fff!important;color:#292333;color-scheme:light}.component-example{padding:20px}.component-example .block{margin:0!important;max-width:100%;box-sizing:border-box}.component-example *{overflow-wrap:anywhere}.component-example .table-scroll{overflow:auto}.component-example table{width:100%}</style>')
  return $.html()
}
