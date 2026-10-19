import {describe,it,expect} from 'vitest'
import {legacyContext} from '../src/legacy-context'
describe('legacy evidence mapping',()=>{
 it('preserves structured analysis dates, parties and change kind without inventing numeric comparisons',()=>{
  const ctx=legacyContext({displayDate:'19.10.2026'},{document:{gazetteDate:'2026-10-01',documentNumber:'2026/7'},change:{type:'AMENDMENT',summary:'Özet',operationalImpact:'Etki'},affectedParties:[{name:'İthalatçı',impact:'Bildirim'}],effectiveDates:[{date:'2026-11-01',description:'Yeni usul'}],comparisons:[{label:'Usul',before:'Kağıt',after:'Elektronik'}],unresolvedReferences:[{reference:'Ek',reason:'Bulunamadı'}]},[])
  expect(ctx.document.changeKind).toBe('AMENDMENT');expect(ctx.analysis.dates.publication).toBe('2026-10-01')
  expect(ctx.analysis.dates.effective[0]?.date).toBe('2026-11-01');expect(ctx.analysis.affected.parties).toEqual(['İthalatçı: Bildirim'])
  expect(ctx.analysis.exceptions).toEqual(['Ek: Bulunamadı']);expect(ctx.analysis.comparison.rows).toEqual([]);expect(ctx.analysis.comparison.note).toContain('Kağıt → Elektronik')
 })
 it('supports wrapped standalone analysis and never uses generation date as publication date',()=>{
  const ctx=legacyContext({displayDate:'19.10.2026'},{analysis:{summary:'Özet',detailedAnalysis:'Ayrıntı',affectedParties:[{name:'Firma',impact:'Kontrol'}]}},[{label:'Belge',url:null}])
  expect(ctx.analysis.summary).toBe('Özet');expect(ctx.analysis.operationalImpact).toBe('Ayrıntı');expect(ctx.document.publicationDate).toBeNull();expect(ctx.analysis.documents[0]?.title).toBe('Belge')
 })
})
