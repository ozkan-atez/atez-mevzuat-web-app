import { aiProvider } from '../../config/google-ai'
import { withUsageContext } from './usage-context'
import { randomUUID } from 'node:crypto'
import type { ChatModelClient } from '../chat/application/chat-model-client'

export interface TokenUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cachedTokens: number | null
  reasoningTokens: number | null
}
export interface UsageCall extends TokenUsage {
  id: string
  conversationId: string
  conversationType: 'GENERAL' | 'REPORT' | 'AUTOMATION' | 'OPERATION' | 'TEMPLATE' | 'RESEARCH'
  usageLabel?: string
  messageId: string
  provider: string | null
  model: string | null
  mode: 'CHAT' | 'WEB' | 'BROWSER' | 'REVISION' | 'NO_MODEL' | 'ANALYSIS' | 'SCAN' | 'TEMPLATE' | 'RESEARCH'
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  startedAt: Date
  completedAt: Date | null
}
export interface UsageRecorder { save(call: UsageCall): Promise<void> }
export const emptyTokens: TokenUsage = { inputTokens: null, outputTokens: null, totalTokens: null, cachedTokens: null, reasoningTokens: null }
export interface GeminiUsageMetadata { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number }
const count = (value: number | undefined) => Number.isSafeInteger(value) && value! >= 0 ? value! : null
export function geminiTokens(metadata?: GeminiUsageMetadata): TokenUsage {
  return {inputTokens: count(metadata?.promptTokenCount), outputTokens: count(metadata?.candidatesTokenCount), totalTokens: count(metadata?.totalTokenCount), cachedTokens: count(metadata?.cachedContentTokenCount), reasoningTokens: count(metadata?.thoughtsTokenCount)}
}

/** A provider stream emits cumulative snapshots. Update one call, never add snapshots. */
export function measuredChatModel(model: ChatModelClient, recorder: UsageRecorder, context: Pick<UsageCall, 'conversationId' | 'conversationType' | 'messageId'>, onCall: () => void): ChatModelClient {
  return {async *streamReply(input) {
    onCall()
    const call: UsageCall = {...emptyTokens, ...context, id: randomUUID(), provider: aiProvider(), model: input.model, mode: input.webSearch ? 'WEB' : 'CHAT', status: 'RUNNING', startedAt: new Date(), completedAt: null}
    await recorder.save(call)
    let completed = false
    try {
      for await (const chunk of model.streamReply(input)) {
        if (chunk.type === 'usage') {
          Object.assign(call, Object.fromEntries(Object.entries(chunk.usage).filter(([, value]) => value !== null)))
          await recorder.save(call)
        } else yield chunk
      }
      completed = true
    } finally {
      call.status = input.signal?.aborted ? 'CANCELLED' : completed ? 'COMPLETED' : 'FAILED'
      call.completedAt = new Date()
      await recorder.save(call)
    }
  }}
}

export function measuredStructuredModel(model: import('../ai/application/ai-model-client').AiModelClient, recorder: UsageRecorder,
  context: Pick<UsageCall, 'conversationId' | 'conversationType' | 'messageId'>): import('../ai/application/ai-model-client').AiModelClient {
  return {async generateStructured(input) {
    const call: UsageCall = {...emptyTokens, ...context, id: randomUUID(), provider: aiProvider(), model: input.model, mode: 'REVISION', status: 'RUNNING', startedAt: new Date(), completedAt: null}
    await recorder.save(call)
    try {
      const response = await withUsageContext({...context, conversationOwned: true}, () => model.generateStructured({...input, onUsage: async usage => {
        Object.assign(call, usage)
        await recorder.save(call)
        await input.onUsage?.(usage)
      }}))
      Object.assign(call, response.usage)
      call.status = 'COMPLETED'
      return response
    } catch (error) {
      call.status = 'FAILED'
      throw error
    } finally {
      call.completedAt = new Date()
      await recorder.save(call)
    }
  }}
}
