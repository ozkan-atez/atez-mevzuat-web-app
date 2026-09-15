import { AiProviderError } from '../../ai/domain/ai-errors'
import { mapGeminiError } from '../../ai/infrastructure/gemini-ai-model-client'
import type { ChatModelClient, ChatModelRequest } from '../application/chat-model-client'

export interface GeminiChatTransportRequest {
  model: string
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>
  config: { systemInstruction: string }
  signal?: AbortSignal
}

export interface GeminiChatTransport {
  generateContentStream(request: GeminiChatTransportRequest): Promise<AsyncIterable<{ text?: string }>>
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
  async *streamReply(input: ChatModelRequest): AsyncIterable<string> {
    const controller = new AbortController()
    let timedOut = false
    const relay = () => controller.abort(input.signal?.reason)
    input.signal?.addEventListener('abort', relay, { once: true })
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, this.options.timeoutMs)

    try {
      const stream = await this.transport.generateContentStream({
        model: input.model,
        contents: input.messages.map((message) => ({ role: message.role, parts: [{ text: message.content }] })),
        config: { systemInstruction: input.systemInstruction },
        signal: controller.signal,
      })
      for await (const chunk of stream) {
        if (timedOut) throw new AiProviderError('TIMEOUT', true, 'Gemini isteği zaman aşımına uğradı.')
        if (chunk.text) yield chunk.text
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

/** Stands in when no API key is configured so the failure stays on one path. */
export class UnavailableChatModelClient implements ChatModelClient {
  constructor(private readonly message: string) {}
  // eslint-disable-next-line require-yield
  async *streamReply(): AsyncIterable<string> {
    throw new AiProviderError('AUTHENTICATION', false, this.message)
  }
}
