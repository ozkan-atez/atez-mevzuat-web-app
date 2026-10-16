import {describe,it,expect,vi} from 'vitest'
import {planChatReports,validateReportGroups,requestedReportCount} from '../../src/modules/chat/application/plan-chat-reports'
const evidence=['a','b'].map(id=>({id,title:id,text:'Belge metni',url:null,publishedOn:null}))
const group=(id:string)=>({title:id,instruction:'Bu kaynağı raporla',sources:[{id,role:'PRIMARY' as const}]})
describe('report request grouping',()=>{
 it.each(['iki ayrı rapor oluştur','2 farklı rapor hazırla','iki rapor oluştur'])('requires two independent outputs for %s',s=>expect(requestedReportCount(s)).toBe(2))
 it('rejects merging an explicit two-report request',()=>expect(()=>validateReportGroups([{...group('a'),sources:[{id:'a',role:'PRIMARY'},{id:'b',role:'SUPPORTING'}]}],evidence,2)).toThrow('2 ayrı'))
 it('keeps previous regulation with its primary for comparison',()=>expect(validateReportGroups([{...group('a'),sources:[{id:'a',role:'PRIMARY'},{id:'b',role:'PREVIOUS'}]}],evidence,1)).toHaveLength(1))
 it('rejects omitted sources and invented identifiers',()=>{
  expect(()=>validateReportGroups([group('a')],evidence,null)).toThrow('bir kısmı')
  expect(()=>validateReportGroups([group('c'),group('b')],evidence,2)).toThrow('doğrulanamadı')
 })
 it('never invokes AI for a single unambiguous source',async()=>{
  const model={generateStructured:vi.fn()}
  expect(await planChatReports('rapor oluştur',evidence.slice(0,1),model,'test')).toHaveLength(1)
  expect(model.generateStructured).not.toHaveBeenCalled()
 })
})
