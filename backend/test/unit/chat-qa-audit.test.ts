import { describe, expect, it, vi } from 'vitest'
import { CHAT_TOOLS, runChatTool } from '../../src/modules/chat/application/chat-tools'
import type { AssistantKnowledge } from '../../src/modules/chat/application/assistant-knowledge'

// QA audit: all dependencies are stubs; no database, external calls or real jobs.
const cases: Array<[string, Record<string, unknown>, string]> = [
 ['islem_kaynaklari_listele',{},'listOperationSources'],
 ['otomasyonlari_listele',{tarih:'2026-10-19'},'listAutomations'],
 ['arsiv_belgelerini_ara',{sorgu:'test'},'searchArchiveDocuments'],
 ['arsiv_belge_surumu_getir',{surumId:'v1'},'getArchiveDocumentVersion'],
 ['eklenen_kaynaklari_ara',{sorgu:'test'},'searchManagedSources'],
 ['eklenen_kaynagi_getir',{kaynakId:'s1'},'getManagedSource'],
 ['raporlari_ara',{sorgu:'test'},'searchReports'],
 ['rapor_getir',{topicId:'t1'},'getReport'],
 ['analiz_getir',{topicId:'t1'},'getAnalysis'],
 ['belgeleri_ara',{sorgu:'test'},'searchDocuments'],
 ['belge_metni_getir',{belgeId:'d1'},'getDocumentText'],
 ['taramalari_listele',{tarih:'2026-10-19'},'listScanRuns'],
 ['onceki_kaynaklari_listele',{topicId:'t1'},'listPreviousSources'],
 ['gonderimleri_listele',{},'listDeliveries'],
 ['dagitim_gruplarini_listele',{},'listCustomerGroups'],
]
describe('QA 2026-10-19: complete tool dispatch inventory',()=>{
 it('accounts for every declared tool',()=>{
  expect(CHAT_TOOLS.map(t=>t.name).sort()).toEqual([...cases.map(c=>c[0]),'bagimsiz_islem_baslat','belge_islemi_baslat','islem_durumu_getir','gtip_tariff_sorgula','tarama_baslat'].sort())
 })
 it.each(cases)('%s dispatches exactly once',async(name,args,method)=>{
  const fn=vi.fn().mockResolvedValue([])
  await runChatTool(name,args,{[method]:fn} as unknown as AssistantKnowledge)
  expect(fn).toHaveBeenCalledTimes(1)
 })
 it.each([
  ['DISCOVER','Kaynakları keşfet'],['CAPTURE','Belgeyi indir'],['FILTER','Belgeleri filtrele'],
  ['PREVIOUS_SOURCES','Önceki kaynakları bul'],['TARIFF_LOOKUP','GTİP sorgula'],
  ['BUILD_REPORT','Rapor oluştur'],['REVISE_ANALYSIS','Analizi düzenle'],['REVISE_REPORT','Raporu düzenle'],
 ])('dispatches independent %s',async(operation,userContent)=>{
  const start=vi.fn().mockResolvedValue({id:'op',status:'QUEUED',tasks:[]})
  await runChatTool('bagimsiz_islem_baslat',{operation},{} as AssistantKnowledge,{operations:{start,get:vi.fn()},selectedVersionIds:['v1'],userContent},'qa')
  expect(start).toHaveBeenCalledTimes(1)
 })
 it.each([['EXTRACT','Belgeyi oku'],['ANALYZE','Belgeyi analiz et']])('dispatches document %s',async(islem,userContent)=>{
  const start=vi.fn().mockResolvedValue({id:'op',status:'QUEUED',tasks:[]})
  await runChatTool('belge_islemi_baslat',{islem},{} as AssistantKnowledge,{operations:{start,get:vi.fn()},selectedVersionIds:['v1'],userContent},'qa')
  expect(start).toHaveBeenCalledTimes(1)
 })
 it('reads operation state',async()=>{
  const get=vi.fn().mockResolvedValue({id:'op'})
  await runChatTool('islem_durumu_getir',{islemId:'op'},{} as AssistantKnowledge,{operations:{start:vi.fn(),get}})
  expect(get).toHaveBeenCalledWith('op')
 })
 it('dispatches tariff and normalizes code',async()=>{
  const lookup=vi.fn().mockResolvedValue({comparisons:[],notes:[]})
  await runChatTool('gtip_tariff_sorgula',{gtip:'0808.10.10.00.00',tarih:'2026-10-19'},{} as AssistantKnowledge,{tariffLookup:{lookup} as any})
  expect(lookup).toHaveBeenCalledWith(expect.objectContaining({code:'080810100000',date:'2026-10-19'}))
 })
 it('starts scan once',async()=>{
  const startScan=vi.fn().mockResolvedValue({id:'qa',status:'QUEUED',targetDate:'2026-10-19'})
  await runChatTool('tarama_baslat',{tarih:'2026-10-19'},{} as AssistantKnowledge,{startScan},'qa')
  expect(startScan).toHaveBeenCalledTimes(1)
 })
})
describe('QA reproducible boundary observations (assert current behavior, not desired behavior)',()=>{
 it('scan tool starts despite explicit user negation',async()=>{
  const startScan=vi.fn().mockResolvedValue({id:'qa',status:'QUEUED',targetDate:'2026-10-19'})
  await runChatTool('tarama_baslat',{tarih:'2026-10-19'},{} as AssistantKnowledge,{scanStarter:{startScan},userContent:'Yeni tarama başlatma; sadece açıkla.'},'qa')
  expect(startScan).toHaveBeenCalledTimes(1)
 })
 it.each([['raporlari_ara','searchReports','baslangicTarihi'],['belgeleri_ara','searchDocuments','baslangicTarihi'],['taramalari_listele','listScanRuns','tarih']])('%s forwards impossible date',async(name,method,key)=>{
  const fn=vi.fn().mockResolvedValue([])
  await runChatTool(name,{[key]:'2026-02-31'}, {[method]:fn} as unknown as AssistantKnowledge)
  expect(JSON.stringify(fn.mock.calls)).toContain('2026-02-31')
 })
 it('missing automation service appears as an empty result',async()=>{
  expect(await runChatTool('otomasyonlari_listele',{},{} as AssistantKnowledge)).toEqual({otomasyonlar:[]})
 })
 it('polite capture request is rejected',async()=>{
  const start=vi.fn()
  await expect(runChatTool('bagimsiz_islem_baslat',{operation:'CAPTURE'},{} as AssistantKnowledge,{operations:{start,get:vi.fn()},userContent:'Belgeyi indirebilir misin?'},'qa')).rejects.toThrow('açık talimat')
  expect(start).not.toHaveBeenCalled()
 })
})
