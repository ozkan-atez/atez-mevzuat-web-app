import { load } from 'cheerio'
import { renderCard } from '../topic-analysis/application/render-report-html'
import { ReportSpecSchema } from '../topic-analysis/domain/report-spec-schemas'
import { BULLETIN_V2_LOGO, renderPageSkeleton } from '../topic-analysis/templates/bulten-v2'

const base = { schemaVersion: 1, templateFamily: 'bulten-v2', reportId: '111026-01', topicId: '11111111-1111-4111-8111-111111111111', documentTitle: 'Mevzuat başlığı', issueNumber: '33300', displayDate: '11 Ekim 2026', typeLabel: 'Değişiklik', title: 'Mevzuat başlığı', summary: 'Mevzuatın kısa özeti burada yer alır.', affectedParties: ['Etkilenen firmalar'], dates: ['Yürürlük tarihi'], note: 'Uygulamada dikkat edilecek açıklama.', source: { label: 'Resmî Gazete', url: 'https://www.resmigazete.gov.tr' }, blocks: ['B1','B10'] }
const samples = [
  {...base, card:'K1'},
  {...base, card:'K2', table:{title:'Mevzuat tablosu',columns:['Tanım','Değer'],rows:[['Birinci kalem','Birinci değer'],['İkinci kalem','İkinci değer']],note:'Tablo açıklaması'}},
  {...base, card:'K3', oldDeadline:'Önceki son tarih',newDeadline:'Yeni son tarih',timeline:[{date:'Tarih',description:'Yapılacak işlem'}]},
  {...base, card:'K4', removedRule:'Kaldırılan düzenleme',replacementRule:'Yeni düzenleme',alert:'Kritik uygulama uyarısı.'},
  {...base, card:'K5', supportingSource:{label:'Destekleyici kaynak',url:'https://ticaret.gov.tr'}},
  {schemaVersion:1,templateFamily:'bulten-v2',card:'K6',reportId:'111026-00',topicId:null,documentTitle:'Değişiklik yok',issueNumber:'33300',displayDate:'11 Ekim 2026',emptyDayText:'Kapsam içi mevzuat değişikliği bulunamadı.',source:base.source,blocks:['B1','B10']},
].map(value => renderCard(ReportSpecSchema.parse(value)))
function component(id:string, heading:string, markup:string) {
  const $ = load(markup,{},false)
  $('[data-field]').each((_,node) => {const el=$(node);el.attr('data-template-content',el.attr('data-field')!);el.removeAttr('data-field')})
  // Columns are content; the table structure and styling remain fixed.
  $('th').each((index,node)=>{ $(node).attr('data-template-content',`table.columns.${index}`) })
  return {id,heading,html:$.html(),enabled:true}
}
const first = load(samples[0]!,{},false), calendar = load(samples[2]!,{},false), repeal = load(samples[3]!,{},false)
export const sectionComponents = [
  ...samples.map((html,index)=>component(`K${index+1}`, ['K1 · Standart mevzuat kartı','K2 · Tablo içeren kart','K3 · Süre ve takvim kartı','K4 · İptal ve kaldırma kartı','K5 · Destekleyici duyuru kartı','K6 · Değişiklik yok kartı'][index]!,html)),
  component('type','B1 · Tür etiketi',first('.badge').toString()),
  component('title','B2 · Mevzuat başlığı',first('.metadata').toString()),
  component('summary','B3 · Kısa özet',first('.block').first().toString()),
  component('impact','B4 · Etkilenenler ve tarihler',first('.block').eq(1).toString()),
  component('dates','B5 · Takvim',calendar('.block').filter((_,node)=>calendar(node).find('.timeline').length>0).toString()),
  component('comparison','B6 · Önceki ve yeni durum',calendar('.block').filter((_,node)=>calendar(node).find('.compare').length>0).toString()),
  component('note','B7 · Not ve kritik uyarı',first('.note').toString()),
  component('table','B8 · Mevzuat tablosu',load(samples[1]!,{},false)('.table-section').toString()),
  component('supporting','B9 · Kaynak sınıflandırması',load(samples[4]!,{},false)('.source-class').toString()),
  component('sources','B10 · Kaynak bağlantısı',first('.source').toString()),
  component('alert','Kritik uyarı',repeal('.note--alert').toString()),
]
export const defaultSections = sectionComponents.filter(section=>['type','title','summary','impact','note','sources'].includes(section.id))
export const templateHtml = renderPageSkeleton({ topicId:'template',documentTitle:'{{title}}',reportId:'{{reportId}}',issueNumber:'{{issueNumber}}',displayDate:'{{date}}',cardHtml:'<article class="card">{{sections}}</article>',logoDataUri:BULLETIN_V2_LOGO })

/** Rebuild known blocks from their canonical markup, copying only text content. */
export class TemplateContentError extends Error {}
export function normalizeTemplateSections(sections:Array<{id:string;heading:string;html:string;enabled:boolean}>, existing:Array<{id:string;heading:string;html:string;enabled:boolean}> = []) {
  return sections.map(section=>{
    const canonical=sectionComponents.find(item=>section.id===item.id || section.id.startsWith(item.id+'-'))
    if(!canonical) {
      const saved=existing.find(item=>item.id===section.id)
      if(!saved) throw new TemplateContentError('Kitaplıktaki hazır bileşenlerden birini seçin.')
      const original=load(saved.html,{},false),edited=load(section.html,{},false)
      const slots=edited('p,li,td')
      original('p,li,td').each((index,node)=>{if(slots.eq(index).length) original(node).text(slots.eq(index).text())})
      return {...section,heading:saved.heading,html:original.html()}
    }
    const original=load(canonical.html,{},false),edited=load(section.html,{},false)
    original('[data-template-content]').each((_,node)=>{
      const target=original(node),key=target.attr('data-template-content')!
      const match=edited('[data-template-content]').filter((_,item)=>edited(item).attr('data-template-content')===key).first()
      if(match.length) target.text(match.text())
    })
    return {...section,heading:canonical.heading,html:original.html()}
  })
}

export function resolveTemplateComponent(section:{id:string;html:string}, spec: import('../topic-analysis/domain/report-spec-schemas').ReportSpec):string | null {
  const canonical=sectionComponents.find(item=>section.id===item.id || section.id.startsWith(item.id+'-'))
  if(!canonical) return null
  const actual=load(renderCard(spec),{},false)
  const selectors:Record<string,string>={type:'.badge',title:'.metadata',summary:'.block:has([data-field="summary"])',impact:'.block:has([data-field^="affectedParties."])',dates:'.block:has(.timeline),.block:has([data-field^="dates."])',comparison:'.block:has(.compare)',note:'.note:not(.note--alert)',alert:'.note--alert',table:'.table-section',supporting:'.source-class',sources:'.source'}
  const markup=canonical.id.startsWith('K') ? actual('article').html() ?? '' : actual(selectors[canonical.id] ?? '').toString()
  const original=load(canonical.html,{},false),edited=load(section.html,{},false),result=load(markup,{},false)
  // Only deliberate changes to an editable text slot override evidenced report data.
  edited('[data-template-content]').each((_,node)=>{
    const element=edited(node),key=element.attr('data-template-content')!
    const initial=original('[data-template-content]').filter((_,item)=>original(item).attr('data-template-content')===key).first()
    if(initial.length && initial.text()!==element.text()) {
      result('[data-field]').filter((_,item)=>result(item).attr('data-field')===key).text(element.text())
      if(key.startsWith('table.columns.')) result('th').eq(Number(key.split('.').at(-1))).text(element.text())
    }
  })
  result('.source').remove() // The publisher adds the verified primary source once.
  return result.html()
}
