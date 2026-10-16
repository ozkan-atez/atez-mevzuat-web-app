import { describe, expect, it } from 'vitest'
import { GeminiChatModelClient } from '../../src/modules/chat/infrastructure/gemini-chat-model-client'
import { GeminiAiModelClient } from '../../src/modules/ai/infrastructure/gemini-ai-model-client'
import { emptyTokens, geminiTokens, measuredChatModel, measuredStructuredModel, type UsageCall, type UsageRecorder } from '../../src/modules/usage/measurement'
import { usagePeriod, usageQuerySchema } from '../../src/modules/usage/usage-query'

const context = {conversationId: 'chat-1', conversationType: 'GENERAL' as const, messageId: 'message-1'}
const request = {model: 'gemini-test', systemInstruction: '', turns: []}
function memory() {
  const calls = new Map<string, UsageCall>()
  const recorder: UsageRecorder = {async save(call) { calls.set(call.id, structuredClone(call)) }}
  return {calls, recorder}
}
async function drain(stream: AsyncIterable<unknown>) { for await (const _ of stream) {} }

describe('provider usage accounting', () => {
  it('replaces cumulative snapshots, separates rounds, and does not add cached/thinking tokens to the total', async () => {
    const {calls, recorder} = memory()
    const provider = new GeminiChatModelClient({async generateContentStream() {
      return (async function* () {
        yield {usageMetadata: {promptTokenCount: 100, candidatesTokenCount: 5, totalTokenCount: 110, cachedContentTokenCount: 80, thoughtsTokenCount: 5}}
        yield {text: 'Yanıt', usageMetadata: {promptTokenCount: 100, candidatesTokenCount: 10, totalTokenCount: 115, cachedContentTokenCount: 80, thoughtsTokenCount: 5}}
      })()
    }}, {timeoutMs: 1000})
    const model = measuredChatModel(provider, recorder, context, () => {})
    await drain(model.streamReply(request)); await drain(model.streamReply({...request, webSearch: true}))
    expect(calls.size).toBe(2)
    expect([...calls.values()].reduce((sum, c) => sum + c.totalTokens!, 0)).toBe(230)
    expect([...calls.values()].map(c => c.mode)).toEqual(['CHAT', 'WEB'])
    expect([...calls.values()][0]).toMatchObject({...context, inputTokens: 100, outputTokens: 10, cachedTokens: 80, reasoningTokens: 5, status: 'COMPLETED'})
  })
  it.each(['FAILED', 'CANCELLED'] as const)('retains observed usage on %s', async status => {
    const {calls, recorder} = memory(), controller = new AbortController()
    const model = measuredChatModel({async *streamReply() {
      yield {type: 'usage', usage: {...emptyTokens, inputTokens: 12, totalTokens: 12}}
      if (status === 'CANCELLED') controller.abort()
      throw new Error('provider failure')
    }}, recorder, context, () => {})
    await expect(drain(model.streamReply({...request, signal: controller.signal}))).rejects.toThrow()
    expect([...calls.values()][0]).toMatchObject({status, inputTokens: 12, totalTokens: 12, completedAt: expect.any(Date)})
  })
  it('does not invent zero when the provider omits usage', async () => {
    const {calls, recorder} = memory()
    await drain(measuredChatModel({async *streamReply() { yield {type: 'text', text: 'ok'} }}, recorder, context, () => {}).streamReply(request))
    expect([...calls.values()][0]).toMatchObject({...emptyTokens, status: 'COMPLETED'})
    expect(geminiTokens({promptTokenCount: -1, candidatesTokenCount: NaN})).toEqual(emptyTokens)
  })
  it('saves structured usage even if JSON validation fails', async () => {
    const {calls, recorder} = memory()
    const provider = new GeminiAiModelClient({async generateContent() {return {text: 'bad json', usageMetadata: {promptTokenCount: 9, candidatesTokenCount: 2, totalTokenCount: 11}}}}, {timeoutMs: 1000})
    await expect(measuredStructuredModel(provider, recorder, {...context, conversationType: 'REPORT'}).generateStructured({model: 'test', parts: [], responseJsonSchema: {}, systemInstruction: ''})).rejects.toThrow()
    expect([...calls.values()][0]).toMatchObject({inputTokens: 9, outputTokens: 2, totalTokens: 11, status: 'FAILED'})
  })
  it('uses inclusive Istanbul dates with an exclusive next-day boundary', () => {
    const query = usageQuerySchema.parse({from: '2026-10-13', to: '2026-10-13'})
    const period = usagePeriod(query)
    expect(period.start.toISOString()).toBe('2026-10-12T21:00:00.000Z')
    expect(period.end.toISOString()).toBe('2026-10-13T21:00:00.000Z')
    expect(usageQuerySchema.safeParse({from: '2026-02-30'}).success).toBe(false)
    expect(usageQuerySchema.safeParse({from: '2026-10-14', to: '2026-10-13'}).success).toBe(false)
  })
})
