import { describe,it,expect } from 'vitest'
import { resolveEffectiveRule,normalizeGtip,turkishDecimal,finalizeDossier,type Dossier } from '../../src/modules/gazette-prototype/dossier'
import type { Bundle } from '../../src/modules/gazette-prototype/contracts'
const evidence={materialId:'m',locator:'Madde 2',quote:'Yürürlük'}
const rule={id:'r',appliesTo:'Tümü',clause:'Yürürlük',mode:'DAYS_AFTER_PUBLICATION' as const,explicitDate:null,daysAfterPublication:30,evidence}
const bundle:Bundle={entry:{id:'e',title:'Tebliğ',url:'https://www.resmigazete.gov.tr/doc.htm',kind:'REGULATION',parentUrl:'https://www.resmigazete.gov.tr/'},materials:[{id:'m',url:'https://www.resmigazete.gov.tr/doc.htm',mime:'text/html',file:'unused',text:'Yürürlük',sha256:'hash',bytes:10,delivery:'TEXT',errors:[]}],errors:[]}
const data:Dossier={title:'Tebliğ',documentType:'TEBLİĞ',documentNumber:null,issuer:'Ticaret Bakanlığı',factualSummary:'Tablo değişti.',amendedInstruments:[],effectiveRules:[rule],scope:{origins:[],conditions:[],exceptions:[]},changes:[],tables:[{id:'t',title:'Gözetim',materialId:'m',locator:'Tablo',effectiveRuleId:'r',origins:[],columns:[{name:'GTİP',kind:'GTIP',unit:null,currency:null},{name:'Birim gümrük kıymeti',kind:'SURVEILLANCE_VALUE_THRESHOLD',unit:'brüt ton',currency:'USD'}],rows:[{rowNumber:1,locator:'Satır1',cells:['6907.21.00.00.00','1.000'],gtips:['6907.21.00.00.00'],productDescription:null,conditions:[],sharedCells:[]}],footnotes:[],complete:true,issues:[]}],otherNumericFacts:[],referencedDocuments:[],materials:[{id:'m',readable:true,allPagesAndTablesCovered:true,issues:[]}],unresolved:[]}
describe('factual dossier and history contract',()=>{
 it('calculates history from effective date, not publication date',()=>{
  expect(resolveEffectiveRule(rule,'2026-07-11')).toMatchObject({resolvedDate:'2026-08-10',previousSnapshotDate:'2026-08-09'})
  expect(resolveEffectiveRule({...rule,mode:'EXPLICIT_DATE',explicitDate:'2026-08-01'},'2026-07-31')).toMatchObject({resolvedDate:'2026-08-01',previousSnapshotDate:'2026-07-31'})
 })
 it('preserves leading zeroes and prefix length without padding guessed GTIPs',()=>{
  expect(normalizeGtip('0301.19.00.00.00')).toBe('030119000000');expect(normalizeGtip('6907')).toBe('6907');expect(normalizeGtip('abc')).toBeNull()
 })
 it('normalizes Turkish decimals while preserving unknown and compound cells',()=>{
  expect(turkishDecimal('1.000')).toBe('1000');expect(turkishDecimal('26,5')).toBe('26.5');expect(turkishDecimal(null)).toBeNull();expect(turkishDecimal('5 + 2 USD')).toBeNull()
 })
 it('does not turn a surveillance threshold into a tax or invent an old value',()=>{
  const out=finalizeDossier(data,bundle,'2026-07-11')
  expect(out.flags.hasSurveillanceThreshold).toBe(true);expect(out.flags.hasTaxRates).toBe(false)
  expect(out.tables[0]!.rows[0]!.values[0]).toMatchObject({decimal:'1000',previousValue:null,changeDirection:'UNKNOWN'})
  expect(out.legacyPlanning.tableRequests[0]).toMatchObject({provider:'TARIFF',asOfDate:'2026-08-09',status:'PENDING'})
  expect(out.readiness.reportReady).toBe(false)
 })
 it('blocks malformed row sets and missing source citations',()=>{
  const bad=structuredClone(data);bad.tables[0]!.rows[0]!.cells=[];bad.effectiveRules[0]!.evidence.materialId='missing'
  expect(finalizeDossier(bad,bundle,'2026-07-11').readiness.extraction).toBe('NEEDS_REVIEW')
 })
 it('leaves ambiguous dates unresolved',()=>{
  expect(resolveEffectiveRule({...rule,mode:'UNRESOLVED'},'2026-07-11').previousSnapshotDate).toBeNull()
 })
})
