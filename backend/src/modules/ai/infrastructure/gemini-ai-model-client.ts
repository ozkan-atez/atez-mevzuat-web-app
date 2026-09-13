import type { AiInputPart, AiModelClient, StructuredAiRequest, StructuredAiResult } from '../application/ai-model-client'
import { AiProviderError } from '../domain/ai-errors'

export interface GeminiTransportRequest {
  model: string
  contents: Array<{ role: 'user'; parts: AiInputPart[] }>
  config: {
    systemInstruction: string
    responseMimeType: 'application/json'
    responseJsonSchema: Record<string, unknown>
  }
}

export interface GeminiTransportResponse {
  text?: string
  responseId?: string
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
  }
}

export interface GeminiTransport {
  generateContent(request: GeminiTransportRequest): Promise<GeminiTransportResponse>
}

export class GeminiAiModelClient implements AiModelClient {
  constructor(
    private readonly transport: GeminiTransport,
    private readonly options: { timeoutMs: number },
  ) {}

  async generateStructured(request: StructuredAiRequest): Promise<StructuredAiResult> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new AiProviderError('TIMEOUT', true, 'Gemini isteği zaman aşımına uğradı.')), this.options.timeoutMs)
      })
      const response = await Promise.race([
        this.transport.generateContent({
          model: request.model,
          contents: [{ role: 'user', parts: request.parts }],
          config: {
            systemInstruction: request.systemInstruction,
            responseMimeType: 'application/json',
            responseJsonSchema: request.responseJsonSchema,
          },
        }),
        timeout,
      ])
      if (!response.text) throw new AiProviderError('INVALID_RESPONSE', true, 'Gemini geçerli bir yapılandırılmış yanıt döndürmedi.')
      let json: unknown
      try {
        json = JSON.parse(response.text)
      } catch {
        throw new AiProviderError('INVALID_RESPONSE', true, 'Gemini geçerli bir yapılandırılmış yanıt döndürmedi.')
      }
      return {
        json,
        providerRequestId: response.responseId ?? null,
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount ?? null,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
        },
      }
    } catch (error) {
      throw mapGeminiError(error)
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

function mapGeminiError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error
  const status = readStatus(error)
  if (status === 401) return new AiProviderError('AUTHENTICATION', false, 'Gemini API anahtarı geçersiz veya eksik.', status)
  if (status === 403) return new AiProviderError('PERMISSION', false, 'Gemini erişim izni reddedildi.', status)
  if (status === 429) {
    const quota = readProviderMessage(error).toLowerCase().includes('quota')
    return quota
      ? new AiProviderError('QUOTA_EXCEEDED', false, 'Gemini kullanım kotası doldu.', status)
      : new AiProviderError('RATE_LIMITED', true, 'Gemini geçici olarak yoğun; istek sınırlandı.', status)
  }
  if (status !== null && status >= 500) return new AiProviderError('PROVIDER_UNAVAILABLE', true, 'Gemini servisi geçici olarak kullanılamıyor.', status)
  if (status === 400) return new AiProviderError('CONTENT_REJECTED', false, 'Gemini gönderilen içeriği kabul etmedi.', status)
  return new AiProviderError('UNKNOWN_PROVIDER_ERROR', false, 'Gemini isteği bilinmeyen bir nedenle başarısız oldu.', status)
}

function readStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const status = Reflect.get(error, 'status')
  return typeof status === 'number' ? status : null
}

function readProviderMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  const message = Reflect.get(error, 'message')
  return typeof message === 'string' ? message : ''
}
