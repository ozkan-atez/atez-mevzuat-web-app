import { describe, expect, it } from 'vitest'
import { sendChatMessage } from '../../src/modules/chat/application/send-chat-message'
import type { ChatModelClient, ChatModelRequest, ChatStreamEvent } from '../../src/modules/chat/application/chat-model-client'
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
  constructor(private readonly deltas: string[] = ['Gümrük ', 'tarifesidir.']) {}
  async *streamReply(input: ChatModelRequest): AsyncIterable<string> {
    this.requests.push(input)
    if (this.error) throw this.error
    for (const delta of this.deltas) yield delta
  }
}

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

    const events = await collect(sendChatMessage({ sessionId: 's1', content: 'GTİP nedir?' }, { repository, model, modelName: 'gemini-test' }))

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

    await collect(sendChatMessage({ sessionId: 's1', content: 'GTİP nedir?' }, { repository, model, modelName: 'gemini-test' }))

    expect(model.requests[0]!.messages).toEqual([
      { role: 'user', content: 'Merhaba' },
      { role: 'model', content: 'Merhaba, nasıl yardımcı olabilirim?' },
      { role: 'user', content: 'GTİP nedir?' },
    ])
  })

  it('keeps only the newest 24 messages within 48000 characters', async () => {
    const repository = new MemoryChatRepository()
    repository.messages = Array.from({ length: 30 }, (_, index) => message(`m${index}`.padEnd(3_000, '.')))
    const model = new StubModel()

    await collect(sendChatMessage({ sessionId: 's1', content: 'Özetle' }, { repository, model, modelName: 'gemini-test' }))

    const sent = model.requests[0]!.messages
    expect(sent.length).toBeLessThanOrEqual(24)
    expect(sent.reduce((sum, item) => sum + item.content.length, 0)).toBeLessThanOrEqual(48_000)
    expect(sent.at(-1)!.content).toBe('Özetle')
  })

  it('leaves a failed answer out of the context it sends', async () => {
    const repository = new MemoryChatRepository()
    repository.messages = [
      message('Merhaba'),
      { id: 'f1', role: 'ASSISTANT', content: '', status: 'FAILED', errorDetail: 'MODEL_GENERATION_FAILED', createdAt: new Date().toISOString() },
    ]
    const model = new StubModel()

    await collect(sendChatMessage({ sessionId: 's1', content: 'Tekrar dene' }, { repository, model, modelName: 'gemini-test' }))

    expect(model.requests[0]!.messages.map((item) => item.content)).toEqual(['Merhaba', 'Tekrar dene'])
  })

  it('records a failed assistant message and reports a safe error', async () => {
    const repository = new MemoryChatRepository()
    const model = new StubModel()
    model.error = new Error('provider secret AIzaSyXXXXXXXXXXXXXXXXXXXXXXX')

    const events = await collect(sendChatMessage({ sessionId: 's1', content: 'Sor' }, { repository, model, modelName: 'gemini-test' }))

    expect(events.at(-1)).toEqual({ type: 'error', message: 'Yapay zekâ yanıtı tamamlanamadı. Lütfen yeniden deneyin.' })
    expect(JSON.stringify(events)).not.toContain('AIza')
    expect(repository.saved.at(-1)).toMatchObject({ role: 'ASSISTANT', status: 'FAILED', content: '' })
  })
})
