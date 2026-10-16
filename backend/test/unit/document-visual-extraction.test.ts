import {describe,it,expect,vi} from 'vitest'
import {extractVisualDocument} from '../../src/modules/documents/application/extract-document'

const model=(json:unknown)=>({generateStructured:vi.fn(async()=>({json,providerRequestId:'ocr',usage:{inputTokens:1,outputTokens:1}}))})
describe('visual document extraction',()=>{
 it('transcribes dates, amounts and tables without rewriting',async()=>{
  const text='GTİP 1234.56.78.90.12 | 14.10.2026 | 12,50 USD'
  const ai=model({complete:true,text,uncertainty:''})
  expect(await extractVisualDocument(Buffer.from('image'),'image/png',ai,'vision')).toMatchObject({status:'READY',text,metadata:{method:'AI_VISUAL_TRANSCRIPTION'}})
  expect(ai.generateStructured).toHaveBeenCalledWith(expect.objectContaining({parts:[{inlineData:{mimeType:'image/png',data:Buffer.from('image').toString('base64')}}]}))
 })
 it.each([{complete:false,text:'partial',uncertainty:'Alt satır kesilmiş'},{complete:true,text:'',uncertainty:''},{complete:true,text:'123?',uncertainty:'Sayı belirsiz'}])('does not accept incomplete evidence',async json=>{
  expect(await extractVisualDocument(Buffer.from('image'),'image/png',model(json),'vision')).toMatchObject({status:'OCR_REQUIRED',text:null})
 })
})
