import { AiProviderError } from '../../ai/domain/ai-errors'
import { mapGeminiError } from '../../ai/infrastructure/gemini-ai-model-client'
import type { ChatModelChunk, ChatModelClient, ChatModelRequest, ChatTurn } from '../application/chat-model-client'

export interface GeminiChatPart {
  text?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
  thoughtSignature?: string
}

export interface GeminiChatTransportRequest {
  model: string
  contents: Array<{ role: 'user' | 'model'; parts: GeminiChatPart[] }>
  config: {
    systemInstruction: string
    tools?: Array<{ functionDeclarations: unknown[] }>
  }
  signal?: AbortSignal
}

export interface GeminiChatChunk {
  text?: string
  functionCalls?: Array<{ name?: string; args?: Record<string, unknown> }>
  /** The raw parts, which carry the thought signature the getter above drops. */
  candidates?: Array<{ content?: { parts?: GeminiChatPart[] } }>
}

export interface GeminiChatTransport {
  generateContentStream(request: GeminiChatTransportRequest): Promise<AsyncIterable<GeminiChatChunk>>
}

export class GeminiChatModelClient implements ChatModelClient {
  constructor(
    private readonly transport: GeminiChatTransport,
    private readonly options: { timeoutMs: number },
  ) {}

  /**
   * The timeout covers the whole stream, not just the first chunk: a provider that
   * stops mid-answer without closing the connection would otherwise hold the
   * request open forever.
   */
  async *streamReply(input: ChatModelRequest): AsyncIterable<ChatModelChunk> {
    const controller = new AbortController()
    let timedOut = false
    const relay = () => controller.abort(input.signal?.reason)
    input.signal?.addEventListener('abort', relay, { once: true })
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, this.options.timeoutMs)

    try {
      const stream = await this.transport.generateContentStream({
        model: input.model,
        contents: input.turns.map(toContent),
        config: {
          systemInstruction: input.systemInstruction,
          ...(input.tools?.length ? { tools: [{ functionDeclarations: input.tools }] } : {}),
        },
        signal: controller.signal,
      })
      for await (const chunk of stream) {
        if (timedOut) throw new AiProviderError('TIMEOUT', true, 'Gemini isteği zaman aşımına uğradı.')
        if (chunk.text) yield { type: 'text', text: chunk.text }
        for (const call of toolCallsOf(chunk)) yield { type: 'tool-call', call }
      }
      if (timedOut) throw new AiProviderError('TIMEOUT', true, 'Gemini isteği zaman aşımına uğradı.')
    } catch (error) {
      if (timedOut) throw new AiProviderError('TIMEOUT', true, 'Gemini isteği zaman aşımına uğradı.')
      // The caller aborted (the browser hung up): that is not a provider fault.
      if (input.signal?.aborted) throw error
      throw mapGeminiError(error)
    } finally {
      clearTimeout(timer)
      input.signal?.removeEventListener('abort', relay)
    }
  }
}

function toContent(turn: ChatTurn): { role: 'user' | 'model'; parts: GeminiChatPart[] } {
  switch (turn.role) {
    case 'user':
      return { role: 'user', parts: [{ text: turn.content }] }
    case 'model':
      return { role: 'model', parts: [{ text: turn.content }] }
    case 'tool-calls':
      return { role: 'model', parts: turn.calls.map((call) => ({
        functionCall: { name: call.name, args: call.args },
        ...(call.signature ? { thoughtSignature: call.signature } : {}),
      })) }
    case 'tool-results':
      // Gemini carries tool output back on a user turn; the pairing with the call
      // above it is what tells the model which answer belongs to which question.
      return { role: 'user', parts: turn.results.map((result) => ({
        functionResponse: { name: result.name, response: asRecord(result.response) },
      })) }
  }
}

/**
 * Reads tool calls from the raw parts when they are there.
 *
 * The SDK's `functionCalls` convenience getter drops the thought signature that
 * sits next to each call, and Gemini 3 refuses the next turn without it.
 */
function toolCallsOf(chunk: GeminiChatChunk): Array<{ name: string; args: Record<string, unknown>; signature?: string }> {
  const parts = chunk.candidates?.[0]?.content?.parts ?? []
  const fromParts = parts.flatMap((part) => (part.functionCall?.name
    ? [{
        name: part.functionCall.name,
        args: part.functionCall.args ?? {},
        ...(part.thoughtSignature ? { signature: part.thoughtSignature } : {}),
      }]
    : []))
  if (fromParts.length > 0) return fromParts
  return (chunk.functionCalls ?? []).flatMap((call) => (call.name ? [{ name: call.name, args: call.args ?? {} }] : []))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { sonuc: value }
}

/** Stands in when no API key is configured so the failure stays on one path. */
export class UnavailableChatModelClient implements ChatModelClient {
  constructor(private readonly message: string) {}
  // eslint-disable-next-line require-yield
  async *streamReply(): AsyncIterable<ChatModelChunk> {
    throw new AiProviderError('AUTHENTICATION', false, this.message)
  }
}
