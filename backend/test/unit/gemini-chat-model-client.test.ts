import { describe, expect, it } from 'vitest'
import { GeminiChatModelClient, UnavailableChatModelClient, type GeminiChatChunk, type GeminiChatTransport, type GeminiChatTransportRequest } from '../../src/modules/chat/infrastructure/gemini-chat-model-client'
import type { ChatModelChunk, ChatModelRequest } from '../../src/modules/chat/application/chat-model-client'

const request: ChatModelRequest = {
  model: 'gemini-test',
  systemInstruction: 'Türkçe yanıtla',
  turns: [{ role: 'user', content: 'Merhaba' }],
}

function transportWith(chunks: GeminiChatChunk[]) {
  const requests: GeminiChatTransportRequest[] = []
  const transport: GeminiChatTransport = {
    async generateContentStream(input) {
      requests.push(input)
      return (async function* () { for (const chunk of chunks) yield chunk })()
    },
  }
  return { transport, requests }
}

async function collect(stream: AsyncIterable<ChatModelChunk>): Promise<ChatModelChunk[]> {
  const items: ChatModelChunk[] = []
  for await (const item of stream) items.push(item)
  return items
}

function texts(chunks: ChatModelChunk[]): string[] {
  return chunks.flatMap((chunk) => (chunk.type === 'text' ? [chunk.text] : []))
}

describe('GeminiChatModelClient', () => {
  it('sends a PDF as a Gemini inline part and a text file as readable text', async () => {
    const { transport, requests } = transportWith([{ text: 'Okundu' }])
    const client = new GeminiChatModelClient(transport, { timeoutMs: 1_000 })
    await collect(client.streamReply({ ...request, turns: [
      { role: 'user', content: 'Bu PDF nedir?', attachment: { name: 'rapor.pdf', mediaType: 'application/pdf', data: Buffer.from('%PDF-1.7').toString('base64') } },
      { role: 'user', content: 'Bunu da oku', attachment: { name: 'not.txt', mediaType: 'text/plain', data: Buffer.from('Gümrük notu').toString('base64') } },
    ] }))
    expect(requests[0]?.contents[0]?.parts[2]).toMatchObject({ inlineData: { mimeType: 'application/pdf' } })
    expect(requests[0]?.contents[1]?.parts[1]?.text).toContain('Gümrük notu')
  })
  it('maps conversation roles and yields only non-empty text chunks', async () => {
    const { transport, requests } = transportWith([{ text: 'Merhaba' }, {}, { text: ' dünya' }])
    const client = new GeminiChatModelClient(transport, { timeoutMs: 1_000 })

    expect(texts(await collect(client.streamReply({
      ...request,
      turns: [{ role: 'user', content: 'Merhaba' }, { role: 'model', content: 'Selam' }],
    })))).toEqual(['Merhaba', ' dünya'])

    expect(requests[0]).toMatchObject({
      model: 'gemini-test',
      contents: [
        { role: 'user', parts: [{ text: 'Merhaba' }] },
        { role: 'model', parts: [{ text: 'Selam' }] },
      ],
      config: { systemInstruction: 'Türkçe yanıtla' },
    })
  })

  it('reads visible raw text when the SDK convenience getter is empty', async () => {
    const { transport } = transportWith([{ text: '', candidates: [{ content: { parts: [
      { text: 'internal', thought: true }, { text: 'Rapor bağlantısı' },
    ] } }] }])
    const client = new GeminiChatModelClient(transport, { timeoutMs: 1_000 })

    expect(texts(await collect(client.streamReply(request)))).toEqual(['Rapor bağlantısı'])
  })

  it('surfaces tool calls and sends the tool result back on the next turn', async () => {
    const { transport, requests } = transportWith([
      { functionCalls: [{ name: 'raporlari_ara', args: { sorgu: 'ithalat' } }] },
    ])
    const client = new GeminiChatModelClient(transport, { timeoutMs: 1_000 })

    const chunks = await collect(client.streamReply({
      ...request,
      tools: [{ name: 'raporlari_ara', description: 'Raporlarda arar', parameters: { type: 'object', properties: {} } }],
      turns: [
        { role: 'user', content: 'Hangi rapor çıktı?' },
        { role: 'tool-calls', calls: [{ name: 'raporlari_ara', args: { sorgu: 'ithalat' } }] },
        { role: 'tool-results', results: [{ name: 'raporlari_ara', response: { raporlar: [] } }] },
      ],
    }))

    expect(chunks).toEqual([{ type: 'tool-call', call: { name: 'raporlari_ara', args: { sorgu: 'ithalat' } } }])
    expect(requests[0]!.contents).toEqual([
      { role: 'user', parts: [{ text: 'Hangi rapor çıktı?' }] },
      { role: 'model', parts: [{ functionCall: { name: 'raporlari_ara', args: { sorgu: 'ithalat' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'raporlari_ara', response: { raporlar: [] } } }] },
    ])
    expect(requests[0]!.config.tools).toHaveLength(1)
  })

  it('carries the thought signature back with the call it belongs to', async () => {
    const { transport, requests } = transportWith([{
      candidates: [{ content: { parts: [{ functionCall: { name: 'rapor_getir', args: { topicId: 't1' } }, thoughtSignature: 'sig-1' }] } }],
    }])
    const client = new GeminiChatModelClient(transport, { timeoutMs: 1_000 })

    const chunks = await collect(client.streamReply(request))
    expect(chunks).toEqual([{ type: 'tool-call', call: { name: 'rapor_getir', args: { topicId: 't1' }, signature: 'sig-1' } }])

    await collect(client.streamReply({
      ...request,
      turns: [{ role: 'tool-calls', calls: [{ name: 'rapor_getir', args: { topicId: 't1' }, signature: 'sig-1' }] }],
    }))
    // Gemini 3 refuses a replayed call whose signature is missing.
    expect(requests[1]!.contents[0]!.parts[0]).toEqual({
      functionCall: { name: 'rapor_getir', args: { topicId: 't1' } }, thoughtSignature: 'sig-1',
    })
  })

  it('offers no tools when the caller passes none', async () => {
    const { transport, requests } = transportWith([{ text: 'Merhaba' }])
    const client = new GeminiChatModelClient(transport, { timeoutMs: 1_000 })

    await collect(client.streamReply(request))

    expect(requests[0]!.config.tools).toBeUndefined()
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
