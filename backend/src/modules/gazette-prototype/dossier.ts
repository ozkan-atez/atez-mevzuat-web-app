import { z } from 'zod'
import { researchNeedSchema } from './tariff-catalog'
import { buildResearchPlan } from './research-plan'
import { DateTime } from 'luxon'
import { cleanText, type Bundle } from './contracts'

const nullableText=z.string().nullable()
const evidence=z.object({materialId:z.string(),locator:z.string(),quote:z.string()}).strict()
const measure=z.enum(['GTIP','PRODUCT_DESCRIPTION','CUSTOMS_DUTY','ADDITIONAL_CUSTOMS_DUTY','ADDITIONAL_FINANCIAL_OBLIGATION','SURVEILLANCE_VALUE_THRESHOLD','QUOTA','OTHER_NUMBER','TEXT'])
export const dossierSchema=z.object({
  researchNeeds:z.array(researchNeedSchema).optional(),
  title:z.string(),documentType:z.string(),documentNumber:nullableText,issuer:nullableText,
  factualSummary:z.string(),
  amendedInstruments:z.array(z.object({title:z.string(),number:nullableText,adoptionDate:nullableText,publicationDate:nullableText,issueNumber:nullableText,provisions:z.array(z.string()),evidence}).strict()),
  effectiveRules:z.array(z.object({id:z.string(),appliesTo:z.string(),clause:z.string(),mode:z.enum(['ON_PUBLICATION','EXPLICIT_DATE','DAYS_AFTER_PUBLICATION','UNRESOLVED']),explicitDate:nullableText,daysAfterPublication:z.number().int().nonnegative().nullable(),evidence}).strict()),
  scope:z.object({origins:z.array(z.string()),conditions:z.array(z.string()),exceptions:z.array(z.string())}).strict(),
  changes:z.array(z.object({id:z.string(),provision:z.string(),operation:z.enum(['REPLACE','ADD','REPEAL','NEW_RULE','OTHER']),fact:z.string(),previousTextInSource:nullableText,newText:z.string(),effectiveRuleId:nullableText,evidence:z.array(evidence)}).strict()),
  tables:z.array(z.object({id:z.string(),title:z.string(),materialId:z.string(),locator:z.string(),effectiveRuleId:nullableText,origins:z.array(z.string()),
    columns:z.array(z.object({name:z.string(),kind:measure,unit:nullableText,currency:nullableText}).strict()),
    rows:z.array(z.object({rowNumber:z.number().int().positive(),locator:z.string(),cells:z.array(nullableText),gtips:z.array(z.string()),productDescription:nullableText,conditions:z.array(z.string()),sharedCells:z.array(z.number().int().nonnegative())}).strict()),
    footnotes:z.array(z.string()),complete:z.boolean(),issues:z.array(z.string())}).strict()),
  otherNumericFacts:z.array(z.object({label:z.string(),rawValue:z.string(),unit:nullableText,context:z.string(),evidence}).strict()),
  referencedDocuments:z.array(z.object({title:z.string(),identifier:nullableText,purpose:z.string(),evidence}).strict()),
  materials:z.array(z.object({id:z.string(),readable:z.boolean(),allPagesAndTablesCovered:z.boolean(),issues:z.array(z.string())}).strict()),
  unresolved:z.array(z.string()),
}).strict()
export type Dossier=z.infer<typeof dossierSchema>
export function resolveEffectiveRule(rule:Dossier['effectiveRules'][number],publicationDate:string) {
  const publication=DateTime.fromISO(publicationDate,{zone:'Europe/Istanbul'})
  const date=rule.mode==='ON_PUBLICATION'?publication:rule.mode==='EXPLICIT_DATE'&&rule.explicitDate?DateTime.fromISO(rule.explicitDate,{zone:'Europe/Istanbul'}):rule.mode==='DAYS_AFTER_PUBLICATION'&&rule.daysAfterPublication!==null?publication.plus({days:rule.daysAfterPublication}):null
  return {...rule,resolvedDate:date?.isValid?date.toISODate():null,previousSnapshotDate:date?.isValid?date.minus({days:1}).toISODate():null,calculation:'Calendar days; Europe/Istanbul; previous snapshot is effective date minus one day.'}
}
export function normalizeGtip(raw:string){const digits=raw.replace(/[.\s]/g,'');return /^\d{4}(?:\d{2}){0,4}$/.test(digits)?digits:null}
export function turkishDecimal(raw:string|null){if(raw===null)return null;const value=raw.trim();return /^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(value)?value.replaceAll('.','').replace(',','.'):null}
const numericKinds=new Set(['CUSTOMS_DUTY','ADDITIONAL_CUSTOMS_DUTY','ADDITIONAL_FINANCIAL_OBLIGATION','SURVEILLANCE_VALUE_THRESHOLD','QUOTA','OTHER_NUMBER'])
export function finalizeDossier(data:Dossier,bundle:Bundle,publicationDate:string){
  const issues=[...data.unresolved,...bundle.errors]
  const expected=bundle.materials.map(m=>m.id)
  if(data.materials.length!==expected.length||new Set(data.materials.map(m=>m.id)).size!==expected.length||data.materials.some(m=>!expected.includes(m.id)))issues.push('Materyal kapsamı kaynak kümesiyle uyuşmuyor.')
  if(data.materials.some(m=>!m.readable||!m.allPagesAndTablesCovered))issues.push('Okunabilirlik veya sayfa/tablo kapsamı eksik.')
  const citations=[...data.amendedInstruments.map(x=>x.evidence),...data.effectiveRules.map(x=>x.evidence),...data.changes.flatMap(x=>x.evidence),...data.otherNumericFacts.map(x=>x.evidence),...data.referencedDocuments.map(x=>x.evidence)]
  for(const e of citations){
    const m=bundle.materials.find(m=>m.id===e.materialId)
    if(!m||!e.quote.trim()||(m.delivery==='TEXT'&&!cleanText(m.text).includes(cleanText(e.quote))))issues.push(`Kanıt doğrulanamadı: ${e.materialId} / ${e.locator}`)
  }
  const effectiveRules=data.effectiveRules.map(r=>resolveEffectiveRule(r,publicationDate))
  if(new Set(effectiveRules.map(r=>r.id)).size!==effectiveRules.length)issues.push('Yürürlük kuralı kimlikleri yineleniyor.')
  if(effectiveRules.some(r=>!r.resolvedDate))issues.push('Çözümlenmemiş yürürlük tarihi var.')
  for(const change of data.changes){if(/\.\.\.|…/.test(change.newText))issues.push(`${change.id}: yeni metin kısaltılmış olabilir; madde kapsamı doğrulanmalı.`)}
  for(const change of data.changes)if(!change.evidence.length||!effectiveRules.some(r=>r.id===change.effectiveRuleId))issues.push(`${change.id}: kanıt veya yürürlük eşleşmesi eksik.`)
  const tables=data.tables.map(t=>{
    if(!expected.includes(t.materialId)||!t.complete||t.issues.length)issues.push(`Tablo ${t.id}: kaynak/kapsam doğrulanmalı.`)
    if(!effectiveRules.some(r=>r.id===t.effectiveRuleId))issues.push(`Tablo ${t.id}: yürürlük eşleşmesi eksik.`)
    if(new Set(t.rows.map(r=>r.rowNumber)).size!==t.rows.length)issues.push(`Tablo ${t.id}: satır numarası yineleniyor.`)
    if(!t.rows.length)issues.push(`Tablo ${t.id}: boş satır kümesi.`)
    const rows=t.rows.map(r=>{
      if(r.cells.length!==t.columns.length)issues.push(`${t.id}/${r.rowNumber}: sütun sayısı uyuşmuyor.`)
      t.columns.forEach((c,i)=>{if(numericKinds.has(c.kind)&&r.cells[i]!=null&&turkishDecimal(r.cells[i]??null)===null)issues.push(`${t.id}/${r.rowNumber}: ${c.name} sayısal hücresi elle veya özel ifade çözücüsüyle doğrulanmalı.`)})
      const gtips=r.gtips.map(raw=>({raw,normalized:normalizeGtip(raw)}))
      if(gtips.some(g=>g.normalized===null))issues.push(`${t.id}/${r.rowNumber}: GTİP çözümlenemedi.`)
      return {...r,gtips,values:t.columns.flatMap((c,i)=>numericKinds.has(c.kind)?[{kind:c.kind,raw:r.cells[i]??null,decimal:turkishDecimal(r.cells[i]??null),unit:c.unit,currency:c.currency,previousValue:null,previousValueStatus:'NOT_COLLECTED',changeDirection:'UNKNOWN'}]:[])}
    })
    return {...t,rows}
  })
  const valueGroups=tables.flatMap(t=>{
    const groups=new Map<string,{tableId:string;origins:string[];conditions:string[];footnotes:string[];values:typeof t.rows[number]['values'];gtips:string[];productDescriptions:string[];sourceRows:number[]}>()
    for(const row of t.rows){
      if(!row.values.length)continue
      const key=JSON.stringify([row.values,row.conditions])
      const group=groups.get(key)??{tableId:t.id,origins:t.origins.length?t.origins:data.scope.origins,conditions:row.conditions,footnotes:t.footnotes,values:row.values,gtips:[],productDescriptions:[],sourceRows:[]}
      group.gtips.push(...row.gtips.flatMap(g=>g.normalized?[g.normalized]:[]));if(row.productDescription&&!group.productDescriptions.includes(row.productDescription))group.productDescriptions.push(row.productDescription)
      group.sourceRows.push(row.rowNumber);groups.set(key,group)
    }
    return [...groups.values()]
  })
  const historyRequests=tables.filter(t=>t.columns.some(c=>numericKinds.has(c.kind))||t.rows.some(r=>r.gtips.length)).map(t=>{
    const rule=effectiveRules.find(r=>r.id===t.effectiveRuleId)
    return {id:`history:${t.id}`,provider:'TARIFF',status:!rule?.resolvedDate?'NEEDS_EFFECTIVE_DATE':t.rows.some(r=>r.gtips.some(g=>g.normalized&&g.normalized.length<12))?'NEEDS_CODE_EXPANSION':'PENDING',tableId:t.id,effectiveDate:rule?.resolvedDate??null,asOfDate:rule?.previousSnapshotDate??null,
      gtips:[...new Set(t.rows.flatMap(r=>r.gtips.flatMap(g=>g.normalized?[g.normalized]:[])))],origins:t.origins.length?t.origins:data.scope.origins,
      measures:[...new Set(t.columns.filter(c=>numericKinds.has(c.kind)).map(c=>c.kind))],measureRequirements:t.columns.filter(c=>numericKinds.has(c.kind)),footnotes:t.footnotes,rowConditions:t.rows.map(r=>({rowNumber:r.rowNumber,gtips:r.gtips,conditions:r.conditions})),conditions:data.scope.conditions,exceptions:data.scope.exceptions,requestedFields:['product_description','previous_effective_value','unit','currency','origin_conditions','legal_basis','valid_from','valid_to','source_url'],
      legalIdentifiers:data.amendedInstruments,purpose:'Yürürlükten hemen önce geçerli değer ve ürün tanımını bul; ilk yayımlanan metni otomatik olarak önceki sürüm sayma.',fallback:'Tariff sonucunun tarih/menşe/ölçü eşleşmesi doğrulanamazsa önceki değer bilinmiyor kalır; Resmî Gazete değişiklik zinciri için ayrı araştırma gerekir.'}
  })
  const legalHistoryRequests=data.changes.filter(c=>['REPLACE','REPEAL'].includes(c.operation)&&c.previousTextInSource===null).map(c=>{
    const rule=effectiveRules.find(r=>r.id===c.effectiveRuleId)
    return {id:`legal-history:${c.id}`,provider:'TARIFF',status:rule?.resolvedDate?'PENDING':'NEEDS_EFFECTIVE_DATE',changeId:c.id,asOfDate:rule?.previousSnapshotDate??null,legalIdentifiers:data.amendedInstruments,purpose:'Değişen hükmün yürürlük öncesindeki son geçerli metnini ve aradaki değişiklik zincirini bul.',fallback:'Tariff yoksa veya hüküm metnini desteklemiyorsa Resmî Gazete araştırması gerekir.'}
  })
  const researchPlan=buildResearchPlan(data.researchNeeds??[],{publicationDate,currentUrl:bundle.entry.url,effectiveRules,tables,legalIdentifiers:data.amendedInstruments})
  return {schemaVersion:'0.3',entry:bundle.entry,publicationDate,classification:'IN',...data,effectiveRules,tables,valueGroups,
    flags:{hasTables:tables.length>0,hasGtips:tables.some(t=>t.rows.some(r=>r.gtips.length)),hasNumericValues:tables.some(t=>t.rows.some(r=>r.values.length))||data.otherNumericFacts.length>0,hasTaxRates:tables.some(t=>t.columns.some(c=>['CUSTOMS_DUTY','ADDITIONAL_CUSTOMS_DUTY'].includes(c.kind))),hasAdditionalFinancialObligation:tables.some(t=>t.columns.some(c=>c.kind==='ADDITIONAL_FINANCIAL_OBLIGATION')),hasSurveillanceThreshold:tables.some(t=>t.columns.some(c=>c.kind==='SURVEILLANCE_VALUE_THRESHOLD')),needsPreviousSource:historyRequests.length>0||legalHistoryRequests.length>0},
    researchPlan,researchPlanningStatus:data.researchNeeds?'PLANNED':'LEGACY_EXTRACTION_NEEDS_REPLAN',legacyPlanning:{deprecated:true,executable:false,tableRequests:historyRequests,legalRequests:legalHistoryRequests},readiness:{extraction:issues.length?'NEEDS_REVIEW':'EXTRACTED',comparison:historyRequests.length||legalHistoryRequests.length?'WAITING_FOR_HISTORY':'NOT_REQUESTED',evidenceAudit:'PENDING',reportReady:false,issues},
    sourceManifest:bundle.materials.map(({id,url,sha256,mime,delivery,file})=>({id,url,sha256,mime,delivery,file})),
  }
}
