import { DateTime } from 'luxon'
import { type ResearchNeed } from './tariff-catalog'

export function buildResearchPlan(needs:ResearchNeed[],context:{publicationDate:string;currentUrl:string;effectiveRules:Array<{id:string;resolvedDate:string|null;previousSnapshotDate:string|null}>;legalIdentifiers:unknown[];tables?:Array<{id:string;effectiveRuleId:string|null;columns:Array<{kind:string;unit:string|null;currency:string|null}>;footnotes:string[]}>}){
 return needs.map(need=>{
  const rule=context.effectiveRules.find(r=>r.id===need.effectiveRuleId)
  const gtips=need.gtips.map(raw=>({raw,normalized:/^\d{4}(?:\d{2}){0,4}$/.test(raw.replace(/[.\s]/g,''))?raw.replace(/[.\s]/g,''):null}))
  const needsExpansion=gtips.some(g=>g.normalized&&g.normalized.length<12)
  const directLegal=need.purpose==='PREVIOUS_LEGAL_TEXT'
  const status=!rule?.resolvedDate||!rule.previousSnapshotDate?'NEEDS_EFFECTIVE_DATE':!directLegal&&(!gtips.length||gtips.some(g=>!g.normalized))?'NEEDS_GTIP':needsExpansion?'NEEDS_CODE_EXPANSION':'PLANNED'
  return {id:need.id,need,executionStatus:status,providerOrder:directLegal?['RESMI_GAZETE']:['TARIFF','RESMI_GAZETE'],
   tariff:directLegal?null:{queryDate:rule?.previousSnapshotDate??null,comparisonEffectiveDate:rule?.resolvedDate??null,gtips,measureKind:need.measureKind,origins:need.origins,comparisonContext:(context.tables??[]).filter(t=>t.effectiveRuleId===need.effectiveRuleId).map(t=>({tableId:t.id,measureRequirements:t.columns.filter(c=>c.kind===need.measureKind),footnotes:t.footnotes})),requestedFields:[...new Set([...need.fields,'measure_validity','geographical_scope','legal_basis'])],retainFullRawResponse:true,
    acceptance:['Seçilen GTİP ve tarih aralığı eşleşmeli.','Önlem türü, ülke/grup, koşullar, birim ve para birimi eşleşmeli.','Eksik/tarihi belirsiz/çelişkili kayıt önceki değer sayılmaz.'],fallbackOn:['NO_MATCH','MISSING_FIELD','AMBIGUOUS_SCOPE','PROVIDER_ERROR','CONFLICT_WITH_OFFICIAL_SOURCE']},
   officialSearch:{status:'NOT_EXECUTED',terms:need.searchTerms,termsMode:'ALTERNATIVE_QUERIES',baseIssueNumberIsNotASearchFilter:true,legalIdentifiers:context.legalIdentifiers,provision:need.provision,initialPublishedThrough:DateTime.fromISO(context.publicationDate).minus({days:1}).toISODate(),applicableOn:rule?.previousSnapshotDate??null,
    extendPublishedThrough:rule?.previousSnapshotDate??null,excludeUrls:[context.currentUrl],includeAllSupplements:true,selection:'Gemini aday içeriklerini ve eklerini okuyarak aynı madde/ek/GTİP için son geçerli hükmü seçer; belirsizlikte REVIEW. Gerekirse birden fazla değişiklik belgesi birlikte kullanılır.',
    validate:['Tarih/başlık/numara resmî kaynaktan doğrulanır.','Yeni düzenlemenin kendisi önceki kaynak seçilemez.','Yürürlük ve sonraki değişiklikler kontrol edilir; yalnız en yeni başlık yeterli değildir.']},
   provenance:{baseInstrument:context.legalIdentifiers,previousApplicableSources:[],currentAmendmentUrl:context.currentUrl,reportClaims:[],status:'AWAITING_EVIDENCE'},
  }
 })
}
