import {describe,it,expect,vi} from 'vitest'
import {reportTariffEvidence} from '../../src/modules/operations/report-tariff-evidence'
const input={documents:[{id:'d',text:'GTİP 1234.56.78.90.12. Yürürlük: 14.10.2026.'}],effectiveDates:[{date:'2026-10-14'}]}
describe('report tariff comparison',()=>{
 it('compares the effective date with the day before and preserves records',async()=>{
  const record={code:'123456789012',date:'2026-10-14',description:null,source:'https://private/api',fetchedAt:'2026-10-14',classification:'SUPPORTING_NON_AUTHORITATIVE' as const,comparisons:[],notes:['Önceki veri eksik.']}
  const lookup=vi.fn(async()=>record)
  const result=await reportTariffEvidence(input,{lookup})
  expect(lookup).toHaveBeenCalledWith({code:'123456789012',date:'2026-10-14',previousDate:'2026-10-13',compare:true})
  expect(result.documents[0]?.text).not.toContain('https://private/api')
  expect(result.documents[0]?.role).toBe('TARIFF');expect(result.warnings).toEqual(record.notes)
 })
 it('does not invent dates or silently hide failed lookups',async()=>{
  const lookup=vi.fn().mockRejectedValue(new Error('offline'))
  expect((await reportTariffEvidence({...input,effectiveDates:[{date:'2026-10-15'}]},{lookup})).warnings).toHaveLength(1)
  expect(lookup).not.toHaveBeenCalled()
  expect((await reportTariffEvidence(input,{lookup})).warnings[0]).toContain('alınamadı')
 })
})
