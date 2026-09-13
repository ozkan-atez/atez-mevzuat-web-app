import { describe, expect, it, vi } from 'vitest'
import { AiProviderError, executeWithAiRetries } from '../../src/modules/ai/domain/ai-errors'
import { GeminiAiModelClient, type GeminiTransport } from '../../src/modules/ai/infrastructure/gemini-ai-model-client'

const request = {
  model: 'gemini-3.8-flash',
  systemInstruction: 'Sınıflandır.',
  parts: [{ text: '{"documents":[]}' }],
  responseJsonSchema: { type: 'object' },
}

function transportWith(value: unknown): GeminiTransport {
  return { generateContent: vi.fn().mockResolvedValue(value) }
}

describe('GeminiAiModelClient', () => {
  it('returns parsed structured JSON and token usage', async () => {
    const transport = transportWith({
      text: '{"decisions":[]}',
      responseId: 'response-1',
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 },
    })
    const client = new GeminiAiModelClient(transport, { timeoutMs: 100 })

    await expect(client.generateStructured(request)).resolves.toEqual({
      json: { decisions: [] },
      providerRequestId: 'response-1',
      usage: { inputTokens: 12, outputTokens: 4 },
    })
  })

  it('maps authentication without leaking provider text or keys', async () => {
    const transport: GeminiTransport = {
      generateContent: vi.fn().mockRejectedValue({ status: 401, message: 'key=super-secret raw provider body' }),
    }
    const client = new GeminiAiModelClient(transport, { timeoutMs: 100 })

    const error = await client.generateStructured(request).catch((caught) => caught)
    expect(error).toBeInstanceOf(AiProviderError)
    expect(error).toMatchObject({ category: 'AUTHENTICATION', retryable: false, providerStatus: 401 })
    expect(String(error)).not.toContain('super-secret')
    expect(String(error)).not.toContain('raw provider body')
  })

  it('maps server failure and timeout to retryable diagnostics', async () => {
    const unavailable = new GeminiAiModelClient({
      generateContent: vi.fn().mockRejectedValue({ status: 503 }),
    }, { timeoutMs: 100 })
    await expect(unavailable.generateStructured(request)).rejects.toMatchObject({
      category: 'PROVIDER_UNAVAILABLE', retryable: true, providerStatus: 503,
    })

    const timeout = new GeminiAiModelClient({
      generateContent: vi.fn(() => new Promise<never>(() => undefined)),
    }, { timeoutMs: 5 })
    await expect(timeout.generateStructured(request)).rejects.toMatchObject({ category: 'TIMEOUT', retryable: true })
  })

  it('reports invalid structured JSON as retryable', async () => {
    const client = new GeminiAiModelClient(transportWith({ text: 'not-json' }), { timeoutMs: 100 })
    await expect(client.generateStructured(request)).rejects.toMatchObject({ category: 'INVALID_RESPONSE', retryable: true })
  })

  it('retries rate limits and succeeds on the third attempt without real waiting', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new AiProviderError('RATE_LIMITED', true, 'Gemini geçici olarak yoğun.', 429))
      .mockRejectedValueOnce(new AiProviderError('RATE_LIMITED', true, 'Gemini geçici olarak yoğun.', 429))
      .mockResolvedValue('ok')
    const sleep = vi.fn().mockResolvedValue(undefined)

    await expect(executeWithAiRetries(operation, { maxAttempts: 3, sleep, random: () => 0 })).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenNthCalledWith(1, 500)
    expect(sleep).toHaveBeenNthCalledWith(2, 1_000)
  })
})
