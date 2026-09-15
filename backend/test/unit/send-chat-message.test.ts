import { describe, expect, it } from 'vitest'
import { sendChatMessage } from '../../src/modules/chat/application/send-chat-message'
import type { ChatModelChunk, ChatModelClient, ChatModelRequest, ChatStreamEvent } from '../../src/modules/chat/application/chat-model-client'
import type { AssistantKnowledge } from '../../src/modules/chat/application/assistant-knowledge'
import type { AppendChatMessageInput, ChatHistoryItem, ChatMessageView, ChatRepository, ChatSessionView } from '../../src/modules/chat/application/ports'

class MemoryChatRepository implements ChatRepository {
  messages: ChatMessageView[] = []
  saved: AppendChatMessageInput[] = []

  async createSession(): Promise<ChatSessionView> { throw new Error('unused') }
  async sessionExists(): Promise<boolean> { return true }
  async getMessages(): Promise<ChatMessageView[]> { return this.messages }
  async listHistory(): Promise<ChatHistoryItem[]> { return [] }
  async deleteSession(): Promise<boolean> { return true }
  async appendMessage(input: AppendChatMessageInput): Promise<ChatMessageView> {
    this.saved.push(input)
    const view: ChatMessageView = {
      id: `m${this.messages.length + 1}`,
      role: input.role,
      content: input.content,
      status: input.status,
      errorDetail: input.errorDetail ?? null,
      createdAt: new Date(2026, 8, 15, 10, this.messages.length).toISOString(),
    }
    this.messages = [...this.messages, view]
    return view
  }
}

class StubModel implements ChatModelClient {
  requests: ChatModelRequest[] = []
  error: Error | null = null
  /** One entry per round; the model is called again after each tool result. */
  rounds: ChatModelChunk[][]

  constructor(deltas: string[] = ['Gümrük ', 'tarifesidir.'], rounds?: ChatModelChunk[][]) {
    this.rounds = rounds ?? [deltas.map((text) => ({ type: 'text', text }))]
  }

  async *streamReply(input: ChatModelRequest): AsyncIterable<ChatModelChunk> {
    this.requests.push(input)
    if (this.error) throw this.error
    for (const chunk of this.rounds[this.requests.length - 1] ?? []) yield chunk
  }
}

const knowledge = {
  searchReports: async () => [{ topicId: 't1', title: 'İthalat Tebliği', card: 'K1', version: 1, gazetteDate: '11 Eylül 2026', issueNumber: '33370', summary: 'Özet', sourceUrl: 'https://resmigazete.gov.tr/x', reportUrl: '/reports/t1?revision=1', publishedAt: '2026-09-11T00:00:00.000Z' }],
} as unknown as AssistantKnowledge

async function collect(events: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const collected: ChatStreamEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

function message(content: string, role: 'USER' | 'ASSISTANT' = 'USER'): ChatMessageView {
  return { id: crypto.randomUUID(), role, content, status: 'COMPLETED', errorDetail: null, createdAt: new Date().toISOString() }
}

describe('sendChatMessage', () => {
  it('persists the user message before streaming and completes one assistant message', async () => {
    const repository = new MemoryChatRepository()
    const model = new StubModel()

    const events = await collect(sendChatMessage({ sessionId: 's1', content: 'GTİP nedir?' }, { repository, model, modelName: 'gemini-test', knowledge }))

    expect(repository.saved.map((item) => item.role)).toEqual(['USER', 'ASSISTANT'])
    expect(events).toEqual([
      { type: 'message', message: expect.objectContaining({ role: 'USER', content: 'GTİP nedir?' }) },
      { type: 'delta', content: 'Gümrük ' },
      { type: 'delta', content: 'tarifesidir.' },
      { type: 'complete', message: expect.objectContaining({ role: 'ASSISTANT', content: 'Gümrük tarifesidir.' }) },
    ])
  })

  it('sends the conversation so far, oldest first, with the new question last', async () => {
    const repository = new MemoryChatRepository()
    repository.messages = [message('Merhaba'), message('Merhaba, nasıl yardımcı olabilirim?', 'ASSISTANT')]
    const model = new StubModel()

    await collect(sendChatMessage({ sessionId: 's1', content: 'GTİP nedir?' }, { repository, model, modelName: 'gemini-test', knowledge }))

    expect(model.requests[0]!.turns).toEqual([
      { role: 'user', content: 'Merhaba' },
      { role: 'model', content: 'Merhaba, nasıl yardımcı olabilirim?' },
      { role: 'user', content: 'GTİP nedir?' },
    ])
  })

  it('keeps only the newest 24 messages within 48000 characters', async () => {
    const repository = new MemoryChatRepository()
    repository.messages = Array.from({ length: 30 }, (_, index) => message(`m${index}`.padEnd(3_000, '.')))
    const model = new StubModel()

    await collect(sendChatMessage({ sessionId: 's1', content: 'Özetle' }, { repository, model, modelName: 'gemini-test', knowledge }))

    const sent = model.requests[0]!.turns
    expect(sent.length).toBeLessThanOrEqual(24)
    expect(sent.reduce((sum, item) => sum + ('content' in item ? item.content.length : 0), 0)).toBeLessThanOrEqual(48_000)
    expect(sent.at(-1)).toMatchObject({ content: 'Özetle' })
  })

  it('leaves a failed answer out of the context it sends', async () => {
    const repository = new MemoryChatRepository()
    repository.messages = [
      message('Merhaba'),
      { id: 'f1', role: 'ASSISTANT', content: '', status: 'FAILED', errorDetail: 'MODEL_GENERATION_FAILED', createdAt: new Date().toISOString() },
    ]
    const model = new StubModel()

    await collect(sendChatMessage({ sessionId: 's1', content: 'Tekrar dene' }, { repository, model, modelName: 'gemini-test', knowledge }))

    expect(model.requests[0]!.turns.map((item) => 'content' in item ? item.content : '')).toEqual(['Merhaba', 'Tekrar dene'])
  })

  it('answers from the platform data by calling a tool and reading the result', async () => {
    const repository = new MemoryChatRepository()
    const model = new StubModel([], [
      [{ type: 'tool-call', call: { name: 'raporlari_ara', args: { sorgu: 'ithalat' } } }],
      [{ type: 'text', text: 'İthalat Tebliği raporu var.' }],
    ])

    const events = await collect(sendChatMessage({ sessionId: 's1', content: 'İthalatla ilgili rapor var mı?' }, { repository, model, modelName: 'gemini-test', knowledge }))

    expect(events).toContainEqual({ type: 'tool', name: 'raporlari_ara', label: 'Bültenlerde arıyor' })
    // The second call must carry the call and its result, or the model would ask again.
    expect(model.requests[1]!.turns.slice(-2)).toEqual([
      { role: 'tool-calls', calls: [{ name: 'raporlari_ara', args: { sorgu: 'ithalat' } }] },
      { role: 'tool-results', results: [{ name: 'raporlari_ara', response: { raporlar: [expect.objectContaining({ topicId: 't1' })] } }] },
    ])
    expect(repository.saved.at(-1)).toMatchObject({ role: 'ASSISTANT', content: 'İthalat Tebliği raporu var.' })
  })

  it('hands a failing tool back to the model instead of losing the answer', async () => {
    const repository = new MemoryChatRepository()
    const model = new StubModel([], [
      [{ type: 'tool-call', call: { name: 'olmayan_arac', args: {} } }],
      [{ type: 'text', text: 'Bu bilgiye ulaşamadım.' }],
    ])

    await collect(sendChatMessage({ sessionId: 's1', content: 'Sor' }, { repository, model, modelName: 'gemini-test', knowledge }))

    expect(model.requests[1]!.turns.at(-1)).toMatchObject({
      role: 'tool-results', results: [{ name: 'olmayan_arac', response: { hata: expect.stringContaining('Tanımsız araç') } }],
    })
    expect(repository.saved.at(-1)).toMatchObject({ status: 'COMPLETED', content: 'Bu bilgiye ulaşamadım.' })
  })

  it('stops asking for tools after the round limit and answers with what it has', async () => {
    const repository = new MemoryChatRepository()
    const call = { type: 'tool-call' as const, call: { name: 'raporlari_ara', args: {} } }
    const model = new StubModel([], [[call], [call], [call], [{ type: 'text', text: 'Elimdeki bilgiyle…' }]])

    await collect(sendChatMessage({ sessionId: 's1', content: 'Sor' }, { repository, model, modelName: 'gemini-test', knowledge }))

    expect(model.requests).toHaveLength(4)
    expect(model.requests.at(-1)!.tools).toBeUndefined()
  })

  it('records a failed assistant message and reports a safe error', async () => {
    const repository = new MemoryChatRepository()
    const model = new StubModel()
    model.error = new Error('provider secret AIzaSyXXXXXXXXXXXXXXXXXXXXXXX')

    const events = await collect(sendChatMessage({ sessionId: 's1', content: 'Sor' }, { repository, model, modelName: 'gemini-test', knowledge }))

    expect(events.at(-1)).toEqual({ type: 'error', message: 'Yapay zekâ yanıtı tamamlanamadı. Lütfen yeniden deneyin.' })
    expect(JSON.stringify(events)).not.toContain('AIza')
    expect(repository.saved.at(-1)).toMatchObject({ role: 'ASSISTANT', status: 'FAILED', content: '' })
  })
})
