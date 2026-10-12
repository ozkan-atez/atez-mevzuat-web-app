import {describe,it,expect} from 'vitest'
import {historyWithinContext,type ChatContext} from '../../src/modules/chat/application/chat-context'
import {meteredChatModel} from '../../src/modules/usage/metered-chat-model'
import {usageDateRange} from '../../src/modules/usage/usage.routes'
import type {UsageInput} from '../../src/modules/usage/usage'
import type {ChatMessageView} from '../../src/modules/chat/application/ports'
const context:ChatContext={mode:'SELECTED',sourceIds:['a'],documentVersionIds:['v1']}
describe('source-scoped evidence and provider measurements',()=>{
 it('excludes old broad exchanges and untracked legacy history',()=>{
  const msg=(id:string,ctx?:ChatContext):ChatMessageView=>({id,role:'ASSISTANT',content:'evidence',status:'COMPLETED',errorDetail:null,createdAt:'',...(ctx?{context:ctx}:{})})
  expect(historyWithinContext([msg('legacy'),msg('ab',{...context,sourceIds:['a','b']}),msg('a',context),msg('private',{...context,documentVersionIds:['v2']})],context).map(m=>m.id)).toEqual(['a'])
 })
 it('replaces cumulative stream counts and keeps distinct tool rounds',async()=>{
  const rows=new Map<string,UsageInput>()
  const client=meteredChatModel({async *streamReply(){yield {type:'usage',usage:{inputTokens:10,outputTokens:2,totalTokens:12,cachedTokens:0,reasoningTokens:0}};yield {type:'usage',usage:{inputTokens:10,outputTokens:5,totalTokens:15,cachedTokens:0,reasoningTokens:0}};yield {type:'text',text:'ok'}}},async r=>{rows.set(r.callId,r)},{sessionId:'s',messageId:'m'})
  for(let i=0;i<2;i++)for await(const chunk of client.streamReply({model:'gemini',systemInstruction:'',turns:[]}))expect(chunk.type).toBe('text')
  expect(rows.size).toBe(2);expect([...rows.values()].reduce((n,r)=>n+(r.totalTokens??0),0)).toBe(30)
 })
 it('retains last measured usage on failure',async()=>{
  let latest:UsageInput|undefined
  const client=meteredChatModel({async *streamReply(){yield {type:'usage',usage:{inputTokens:10,outputTokens:2,totalTokens:12,cachedTokens:null,reasoningTokens:null}};throw new Error('failed')}},async r=>{latest=r},{sessionId:'s',messageId:'m'})
  await expect((async()=>{for await(const _ of client.streamReply({model:'g',systemInstruction:'',turns:[]})){/* drain */}})()).rejects.toThrow('failed')
  expect(latest).toMatchObject({status:'FAILED',totalTokens:12})
 })
 it('uses Istanbul day boundaries and rejects impossible dates',()=>{
  const range=usageDateRange('2026-10-12','2026-10-12')
  expect(range.gte.toISOString()).toBe('2026-10-11T21:00:00.000Z');expect(range.lt.toISOString()).toBe('2026-10-12T21:00:00.000Z')
  expect(()=>usageDateRange('2026-02-30','2026-03-01')).toThrow()
 })
})
