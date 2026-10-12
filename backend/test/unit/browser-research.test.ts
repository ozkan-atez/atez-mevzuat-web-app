import {beforeEach,describe,expect,it,vi} from 'vitest'
import type {GoogleGenAI} from '@google/genai'
import {GeminiBrowserResearch,browserStartUrl,assertBrowserAction} from '../../src/modules/chat/infrastructure/gemini-browser-research'
const fake=vi.hoisted(()=>({close:vi.fn(),contextClose:vi.fn(),route:vi.fn(),goto:vi.fn(),generate:vi.fn()}))
vi.mock('playwright',()=>({chromium:{launch:async()=>({close:fake.close,newContext:async()=>({route:fake.route,close:fake.contextClose,newPage:async()=>({goto:fake.goto,waitForTimeout:async()=>{},url:()=> 'https://ggm.ticaret.gov.tr/duyurular',title:async()=> 'Ticaret Bakanlığı',screenshot:async()=>Buffer.from('test')})})})}}))
beforeEach(()=>{vi.clearAllMocks();fake.goto.mockResolvedValue({ok:()=>true});fake.generate.mockResolvedValue({candidates:[{content:{role:'model',parts:[{text:'Duyurular incelendi.'}]}}],text:'Duyurular incelendi.'})})
describe('chat-only browser research',()=>{
 it('uses the current Turkey date for a today request and preserves explicit URLs',()=>{
   expect(browserStartUrl('resmigazete bugünkü kararları incele','2026-10-12')).toBe('https://www.resmigazete.gov.tr/fihrist?tarih=2026-10-12')
   expect(browserStartUrl('https://www.resmigazete.gov.tr/eskiler/2026/09/20260906.htm incele','2026-10-12')).toBe('https://www.resmigazete.gov.tr/eskiler/2026/09/20260906.htm')
 })
 it('rejects login requests before launching or sending the prompt to Gemini',async()=>{
   const service=new GeminiBrowserResearch({models:{generateContent:fake.generate}} as unknown as GoogleGenAI,'test')
   await expect((async()=>{for await(const event of service.run({content:'TARIFF için giriş yap'}))void event})()).rejects.toMatchObject({category:'LOGIN_UNSUPPORTED'})
   expect(fake.generate).not.toHaveBeenCalled()
 })
 it('records safe provider diagnostics for missing candidates',async()=>{
   fake.generate.mockResolvedValueOnce({candidates:[],promptFeedback:{blockReason:'SAFETY'}})
   const service=new GeminiBrowserResearch({models:{generateContent:fake.generate}} as unknown as GoogleGenAI,'test')
   await expect((async()=>{for await(const event of service.run({content:'https://ggm.ticaret.gov.tr'}))void event})()).rejects.toMatchObject({category:'MODEL_NO_CANDIDATE',diagnostics:{candidateCount:0,blockReason:'SAFETY'}})
 })
 it('rejects private destinations and action confirmations',()=>{
   expect(()=>browserStartUrl('https://127.0.0.1/private')).toThrow()
   expect(()=>assertBrowserAction({safety_decision:{decision:'require_confirmation'}})).toThrow()
 })
 it('returns inspected sources and releases the separate browser',async()=>{
   const api={models:{generateContent:fake.generate}} as unknown as GoogleGenAI
   const service=new GeminiBrowserResearch(api,'test')
   const events=[];for await(const event of service.run({content:'https://ggm.ticaret.gov.tr/duyurular incele'}))events.push(event)
   expect(events.at(-1)).toMatchObject({type:'result',research:{mode:'browser',completed:true,sources:[{title:'Ticaret Bakanlığı',url:'https://ggm.ticaret.gov.tr/duyurular'}]}})
   expect(fake.close).toHaveBeenCalledOnce()
 })
 it('closes the browser if the provider fails and makes capacity available again',async()=>{
   fake.generate.mockRejectedValueOnce(new Error('Provider error'))
   const service=new GeminiBrowserResearch({models:{generateContent:fake.generate}} as unknown as GoogleGenAI,'test')
   await expect((async()=>{for await(const event of service.run({content:'https://ggm.ticaret.gov.tr'}))void event})()).rejects.toThrow('Provider error')
   expect(fake.close).toHaveBeenCalledOnce()
   const events=[];for await(const event of service.run({content:'https://ggm.ticaret.gov.tr'}))events.push(event)
   expect(events.at(-1)?.type).toBe('result')
 })
})
