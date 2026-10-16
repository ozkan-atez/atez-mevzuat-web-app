import { afterEach, describe, expect, it, vi } from 'vitest'
import { aiProvider, googleAiOptions } from '../../src/config/google-ai'
import { measuredChatModel, emptyTokens, type UsageCall } from '../../src/modules/usage/measurement'

afterEach(() => vi.unstubAllEnvs())
describe('Google AI provider configuration', () => {
  it('uses ADC for Vertex even if a legacy API key remains', () => {
    expect(googleAiOptions({GOOGLE_GENAI_USE_VERTEXAI:'true', GOOGLE_CLOUD_PROJECT:'company', GOOGLE_CLOUD_LOCATION:'global', GEMINI_API_KEY:'legacy'})).toEqual({vertexai:true,project:'company',location:'global'})
  })
  it('fails closed for incomplete Vertex configuration', () => {
    expect(() => googleAiOptions({GOOGLE_GENAI_USE_VERTEXAI:'true', GEMINI_API_KEY:'legacy'})).toThrow('GOOGLE_CLOUD_PROJECT')
    expect(() => aiProvider({GOOGLE_GENAI_USE_VERTEXAI:'typo'})).toThrow()
  })
  it('retains explicit Developer API support', () => {
    expect(googleAiOptions({GEMINI_API_KEY:'key'})).toEqual({vertexai:false,apiKey:'key'})
    expect(googleAiOptions({})).toBeUndefined()
  })
  it('records Vertex cumulative usage once with reasoning and cache separated', async () => {
    vi.stubEnv('GOOGLE_GENAI_USE_VERTEXAI','true')
    const calls = new Map<string, UsageCall>()
    const model = measuredChatModel({async *streamReply() {
      yield {type:'usage',usage:{...emptyTokens,inputTokens:10,outputTokens:1,totalTokens:15,reasoningTokens:4,cachedTokens:5}}
      yield {type:'usage',usage:{...emptyTokens,inputTokens:10,outputTokens:2,totalTokens:16,reasoningTokens:4,cachedTokens:5}}
    }}, {async save(call) {calls.set(call.id,structuredClone(call))}}, {conversationId:'test',conversationType:'GENERAL',messageId:'test'},()=>{})
    for await (const _ of model.streamReply({model:'test',systemInstruction:'',turns:[]})) {}
    expect(calls.size).toBe(1)
    expect([...calls.values()][0]).toMatchObject({provider:'vertex',totalTokens:16,inputTokens:10,outputTokens:2,reasoningTokens:4,cachedTokens:5,status:'COMPLETED'})
  })
})
