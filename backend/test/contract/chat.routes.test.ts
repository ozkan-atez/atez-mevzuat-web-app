import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../src/app'
import type { ChatModelClient } from '../../src/modules/chat/application/chat-model-client'
import type { AssistantKnowledge } from '../../src/modules/chat/application/assistant-knowledge'
import type { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'
import type { AppendChatMessageInput, ChatHistoryItem, ChatMessageView, ChatRepository, ChatSessionView } from '../../src/modules/chat/application/ports'

class MemoryChatRepository implements ChatRepository {
  sessions = new Map<string, ChatMessageView[]>()
  titles = new Map<string, string>()
  failNext: Error | null = null

  async createSession(): Promise<ChatSessionView> {
    const id = `session-${this.sessions.size + 1}`
    this.sessions.set(id, [])
    return { id, title: null, createdAt: '2026-09-15T10:00:00.000Z', updatedAt: '2026-09-15T10:00:00.000Z' }
  }
  async sessionExists(id: string): Promise<boolean> { return this.sessions.has(id) }
  async getMessages(sessionId: string): Promise<ChatMessageView[]> { return this.sessions.get(sessionId) ?? [] }
  async getSessionTitle(sessionId: string): Promise<string | null> { return this.titles.get(sessionId) ?? null }
  async setTitleIfMatches(sessionId: string, expectedTitle: string | null, title: string): Promise<void> { if ((this.titles.get(sessionId) ?? null) === expectedTitle) this.titles.set(sessionId, title) }
  async appendMessage(input: AppendChatMessageInput): Promise<ChatMessageView> {
    const messages = this.sessions.get(input.sessionId) ?? []
    const view: ChatMessageView = {
      id: `m${messages.length + 1}`, role: input.role, content: input.content,
      status: input.status, errorDetail: input.errorDetail ?? null, createdAt: '2026-09-15T10:00:01.000Z',
    }
    this.sessions.set(input.sessionId, [...messages, view])
    return view
  }
  async listHistory(): Promise<ChatHistoryItem[]> {
    return [...this.sessions.keys()].map((id) => ({
      id, type: 'GENERAL', title: this.titles.get(id) ?? 'Yeni sohbet', preview: null, messageCount: this.sessions.get(id)!.length,
      updatedAt: '2026-09-15T10:00:00.000Z', target: `/chat/${id}`,
    }))
  }
  async deleteSession(id: string): Promise<boolean> { return this.sessions.delete(id) }
}

const model: ChatModelClient = {
  async *streamReply() {
    yield { type: 'text', text: 'GTİP' }
    yield { type: 'text', text: ' tarife kodudur.' }
  },
}

const knowledge = {
  searchReports: async () => [],
} as unknown as AssistantKnowledge

const failingModel: ChatModelClient = {
  // eslint-disable-next-line require-yield
  async *streamReply() { throw new Error('provider down') },
}

let app: FastifyInstance
let repository: MemoryChatRepository

async function startApp(chatModel: ChatModelClient = model) {
  repository = new MemoryChatRepository()
  return buildApp({ chatRepository: repository, chatModel, chatModelName: 'gemini-test', chatKnowledge: knowledge })
}

describe('chat routes', () => {
  beforeAll(async () => { app = await startApp() })
  afterAll(() => app.close())

  it('creates a session and streams typed events for a valid message', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/chat/sessions' })
    expect(created.statusCode).toBe(201)
    const sessionId = created.json<{ id: string }>().id

    const response = await app.inject({
      method: 'POST', url: `/api/v1/chat/sessions/${sessionId}/messages`, payload: { content: 'GTİP nedir?' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/event-stream')
    expect(response.body).toContain('event: message')
    expect(response.body).toContain('event: delta\ndata: {"type":"delta","content":"GTİP"}')
    expect(response.body).toContain('event: complete')
    expect(response.body).toContain('GTİP tarife kodudur.')
  })

  it('queues a dated manual scan through the shared scan repository', async () => {
    const createManualRun = vi.fn(async ({ targetDate }: { targetDate: string; requestKey: string }) => ({ id: 'run-28', status: 'QUEUED' as const, targetDate }))
    const toolModel: ChatModelClient = {
      async *streamReply(input) {
        if (input.turns.some((turn) => turn.role === 'tool-results')) {
          yield { type: 'text', text: 'Tarama kuyruğa alındı: [İncele](/runs/run-28)' }
        } else {
          yield { type: 'tool-call', call: { name: 'tarihli_tarama_baslat', args: { tarih: '2026-07-28' } } }
        }
      },
    }
    const scanApp = await buildApp({
      chatRepository: new MemoryChatRepository(), chatModel: toolModel, chatModelName: 'gemini-test', chatKnowledge: knowledge,
      scanRepository: { createManualRun } as unknown as PrismaScanRepository,
    })
    try {
      const sessionId = (await scanApp.inject({ method: 'POST', url: '/api/v1/chat/sessions' })).json<{ id: string }>().id
      const response = await scanApp.inject({ method: 'POST', url: `/api/v1/chat/sessions/${sessionId}/messages`, payload: { content: '28 Temmuz 2026 için rapor oluşturma işlemini başlat' } })
      expect(createManualRun).toHaveBeenCalledOnce()
      expect(response.body).toContain('tarihli_tarama_baslat')
      expect(response.body).toContain('/runs/run-28')
      expect(response.body).toContain('event: complete')
    } finally {
      await scanApp.close()
    }
  })

  it('returns the stored transcript for a session', async () => {
    const sessionId = (await app.inject({ method: 'POST', url: '/api/v1/chat/sessions' })).json<{ id: string }>().id
    await app.inject({ method: 'POST', url: `/api/v1/chat/sessions/${sessionId}/messages`, payload: { content: 'Merhaba' } })

    const response = await app.inject({ method: 'GET', url: `/api/v1/chat/sessions/${sessionId}/messages` })

    expect(response.json<{ messages: ChatMessageView[] }>().messages.map((item) => item.role)).toEqual(['USER', 'ASSISTANT'])
  })

  it.each(['', ' ', 'x'.repeat(8_001)])('rejects invalid message content', async (content) => {
    const sessionId = (await app.inject({ method: 'POST', url: '/api/v1/chat/sessions' })).json<{ id: string }>().id

    const response = await app.inject({ method: 'POST', url: `/api/v1/chat/sessions/${sessionId}/messages`, payload: { content } })

    expect(response.statusCode).toBe(400)
  })

  it('rejects unsupported attachments before opening a response stream', async () => {
    const sessionId = (await app.inject({ method: 'POST', url: '/api/v1/chat/sessions' })).json<{ id: string }>().id
    const response = await app.inject({ method: 'POST', url: `/api/v1/chat/sessions/${sessionId}/messages`, payload: {
      content: 'Oku', attachment: { name: 'script.sh', mediaType: 'application/x-sh', data: 'YQ==' },
    } })
    expect(response.statusCode).toBe(400)
    expect(response.json<{ message: string }>().message).toContain('desteklenmiyor')
  })

  it('returns 404 for an unknown session on read, send, and delete', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/chat/sessions/missing/messages' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/api/v1/chat/sessions/missing/messages', payload: { content: 'Merhaba' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/chat/sessions/missing' })).statusCode).toBe(404)
  })

  it('deletes a session it owns and lists the rest as history', async () => {
    const sessionId = (await app.inject({ method: 'POST', url: '/api/v1/chat/sessions' })).json<{ id: string }>().id

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/chat/sessions/${sessionId}` })).statusCode).toBe(204)
    const history = (await app.inject({ method: 'GET', url: '/api/v1/chat/sessions' })).json<{ sessions: ChatHistoryItem[] }>().sessions
    expect(history.map((item) => item.id)).not.toContain(sessionId)
  })

  it('reports a provider failure as an error event without leaking the provider message', async () => {
    const failingApp = await startApp(failingModel)
    const sessionId = (await failingApp.inject({ method: 'POST', url: '/api/v1/chat/sessions' })).json<{ id: string }>().id

    const response = await failingApp.inject({
      method: 'POST', url: `/api/v1/chat/sessions/${sessionId}/messages`, payload: { content: 'Sor' },
    })

    expect(response.body).toContain('event: error')
    expect(response.body).not.toContain('provider down')
    await failingApp.close()
  })
})
