import{describe,it,expect}from'vitest'
import{createTariffSnapshot}from'../../src/modules/gazette-prototype/tariff-snapshot'
import{buildResearchPlan}from'../../src/modules/gazette-prototype/research-plan'
import{researchNeedSchema,providerFieldInventory,type ResearchNeed}from'../../src/modules/gazette-prototype/tariff-catalog'
const need:ResearchNeed={id:'n',fields:['measure_value','duty_components','footnotes'],purpose:'PREVIOUS_VALUE',measureKind:'SURVEILLANCE_VALUE_THRESHOLD',gtips:['6910.90.00.00.00'],origins:[],effectiveRuleId:'r',provision:'Madde 1 tablosu',searchTerms:['2018/5','İthalatta Gözetim'],reason:'Önceki eşik kaynakta yok.'}
const context={publicationDate:'2026-07-11',currentUrl:'https://www.resmigazete.gov.tr/eskiler/2026/07/20260711-31.htm',effectiveRules:[{id:'r',resolvedDate:'2026-08-10',previousSnapshotDate:'2026-08-09'}],legalIdentifiers:[]}
describe('catalog driven previous research',()=>{
 it('retains unknown provider fields and does not claim date validity',()=>{
 const raw={measures:[{futureUnknown:{code:42}}],commodities:[]};const saved=createTariffSnapshot(raw,{gtip:'691090000000',queryDate:'2026-08-09',url:'https://tariff.singlewindow.io/api/example'});raw.measures[0]!.futureUnknown.code=0;expect(saved.raw).toEqual({measures:[{futureUnknown:{code:42}}],commodities:[]});expect(saved.validation.status).toBe('UNVALIDATED')
 })
 it('uses effective date predecessor and keeps publication search window separate',()=>{
 const p=buildResearchPlan([need],context)[0]!
 expect(p.tariff).toMatchObject({queryDate:'2026-08-09',comparisonEffectiveDate:'2026-08-10',retainFullRawResponse:true})
 expect(p.officialSearch).toMatchObject({initialPublishedThrough:'2026-07-10',extendPublishedThrough:'2026-08-09',includeAllSupplements:true,excludeUrls:[context.currentUrl]})
 expect(p.provenance.previousApplicableSources).toEqual([])
 })
 it('cannot execute ambiguous dates, missing codes or incomplete tariff prefixes',()=>{
 expect(buildResearchPlan([need],{...context,effectiveRules:[]})[0]!.executionStatus).toBe('NEEDS_EFFECTIVE_DATE')
 expect(buildResearchPlan([{...need,gtips:[]}],context)[0]!.executionStatus).toBe('NEEDS_GTIP')
 expect(buildResearchPlan([{...need,gtips:['6910']}],context)[0]!.executionStatus).toBe('NEEDS_CODE_EXPANSION')
 })
 it('routes legal text to official source without pretending tariff supplies full text',()=>{
 const p=buildResearchPlan([{...need,purpose:'PREVIOUS_LEGAL_TEXT',gtips:[]}],context)[0]!
 expect(p.providerOrder).toEqual(['RESMI_GAZETE']);expect(p.tariff).toBeNull();expect(p.executionStatus).toBe('PLANNED')
 })
 it('rejects nonexistent capabilities and preserves nested inventory paths',()=>{
 expect(researchNeedSchema.safeParse({...need,fields:['guaranteed_quota_balance']}).success).toBe(false)
 expect(providerFieldInventory({measures:[{conditions:[{document_code:'0964'}],novelField:null}]})).toContainEqual({path:'$.measures[].conditions[].document_code',types:['string']})
 expect(providerFieldInventory({novelField:null})).toContainEqual({path:'$.novelField',types:['null']})
 })
})
