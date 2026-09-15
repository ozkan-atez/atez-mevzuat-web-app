import { describe, expect, it } from 'vitest'
import { GeminiChatModelClient, UnavailableChatModelClient, type GeminiChatTransport, type GeminiChatTransportRequest } from '../../src/modules/chat/infrastructure/gemini-chat-model-client'
import type { ChatModelRequest } from '../../src/modules/chat/application/chat-model-client'

const request: ChatModelRequest = {
  model: 'gemini-test',
  systemInstruction: 'Türkçe yanıtla',
  messages: [{ role: 'user', content: 'Merhaba' }],
}

function transportWith(chunks: Array<{ text?: string }>) {
  const requests: GeminiChatTransportRequest[] = []
  const transport: GeminiChatTransport = {
    async generateContentStream(input) {
      requests.push(input)
      return (async function* () { for (const chunk of chunks) yield chunk })()
    },
  }
  return { transport, requests }
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const items: string[] = []
  for await (const item of stream) items.push(item)
  return items
}

describe('GeminiChatModelClient', () => {
  it('maps conversation roles and yields only non-empty text chunks', async () => {
    const { transport, requests } = transportWith([{ text: 'Merhaba' }, {}, { text: ' dünya' }])
    const client = new GeminiChatModelClient(transport, { timeoutMs: 1_000 })

    expect(await collect(client.streamReply({
      ...request,
      messages: [{ role: 'user', content: 'Merhaba' }, { role: 'model', content: 'Selam' }],
    }))).toEqual(['Merhaba', ' dünya'])

    expect(requests[0]).toMatchObject({
      model: 'gemini-test',
      contents: [
        { role: 'user', parts: [{ text: 'Merhaba' }] },
        { role: 'model', parts: [{ text: 'Selam' }] },
      ],
      config: { systemInstruction: 'Türkçe yanıtla' },
    })
  })

  it('fails with a timeout when the stream never ends', async () => {
    const transport: GeminiChatTransport = {
      async generateContentStream() {
        return (async function* () {
          while (true) {
            await new Promise((resolve) => setTimeout(resolve, 5))
            yield { text: '.' }
          }
        })()
      },
    }
    const client = new GeminiChatModelClient(transport, { timeoutMs: 20 })

    await expect(collect(client.streamReply(request))).rejects.toMatchObject({ category: 'TIMEOUT' })
  })

  it('turns a provider failure into a safe categorised error', async () => {
    const transport: GeminiChatTransport = {
      async generateContentStream() { throw Object.assign(new Error('key=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXX rejected'), { status: 401 }) },
    }
    const client = new GeminiChatModelClient(transport, { timeoutMs: 1_000 })

    await expect(collect(client.streamReply(request))).rejects.toMatchObject({
      category: 'AUTHENTICATION', message: 'Gemini API anahtarı geçersiz veya eksik.',
    })
  })

  it('reports a missing API key on the same error path as a provider failure', async () => {
    const client = new UnavailableChatModelClient('Gemini API anahtarı yapılandırılmamış.')

    await expect(collect(client.streamReply())).rejects.toMatchObject({ category: 'AUTHENTICATION' })
  })
})
