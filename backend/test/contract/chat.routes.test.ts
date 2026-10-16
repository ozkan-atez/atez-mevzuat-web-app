import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../src/app'
import type { ChatModelClient } from '../../src/modules/chat/application/chat-model-client'
import type { AssistantKnowledge } from '../../src/modules/chat/application/assistant-knowledge'
import type { AppendChatMessageInput, ChatHistoryItem, ChatMessageView, ChatRepository, ChatSessionView } from '../../src/modules/chat/application/ports'

class MemoryChatRepository implements ChatRepository {
  sessions = new Map<string, ChatMessageView[]>()
  failNext: Error | null = null

  async createSession(): Promise<ChatSessionView> {
    const id = `session-${this.sessions.size + 1}`
    this.sessions.set(id, [])
    return { id, title: null, createdAt: '2026-09-15T10:00:00.000Z', updatedAt: '2026-09-15T10:00:00.000Z' }
  }
  async sessionExists(id: string): Promise<boolean> { return this.sessions.has(id) }
  async getMessages(sessionId: string): Promise<ChatMessageView[]> { return this.sessions.get(sessionId) ?? [] }
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
      id, type: 'GENERAL', title: 'Sohbet', preview: null, messageCount: this.sessions.get(id)!.length,
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
  return buildApp({ authRuntime: false, chatRepository: repository, chatModel, chatModelName: 'gemini-test', chatKnowledge: knowledge })
}

describe('chat routes', () => {
  beforeAll(async () => { app = await startApp() })
  afterAll(() => app.close())

  it('rejects missing or conflicting source context before saving a message', async () => {
    const sessionId = (await app.inject({method: 'POST', url: '/api/v1/chat/sessions'})).json<{id: string}>().id
    const sourceId = '00000000-0000-4000-8000-000000000001'
    const missing = await app.inject({method: 'POST', url: `/api/v1/chat/sessions/${sessionId}/messages`, payload: {content: 'Özetle', sourceIds: [sourceId]}})
    expect(missing.statusCode).toBe(404)
    const conflict = await app.inject({method: 'POST', url: `/api/v1/chat/sessions/${sessionId}/messages`, payload: {content: 'Özetle', sourceIds: [sourceId], webSearch: true}})
    expect(conflict.statusCode).toBe(400)
    const template = await app.inject({method: 'POST', url: `/api/v1/chat/sessions/${sessionId}/messages`, payload: {content: 'Özetle', templateId: sourceId}})
    expect(template.statusCode).toBe(404)
    expect(await repository.getMessages(sessionId)).toEqual([])
  })

  it.each(['webSearch', 'browserAgent'])('rejects disabled %s on direct API requests', async mode => {
    const created = await app.inject({method:'POST',url:'/api/v1/chat/sessions',payload:{}})
    const id=created.json().id
    const response=await app.inject({method:'POST',url:`/api/v1/chat/sessions/${id}/messages`,payload:{content:'Araştır',[mode]:true}})
    expect(response.statusCode).toBe(400)
    expect(response.json().message).toContain('şu anda kapalı')
  })

  it('returns chat context options and validates source searches', async () => {
    const response = await app.inject({method: 'GET', url: '/api/v1/chat/context'})
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({sources: [], templates: []})
    const invalid = await app.inject({method: 'GET', url: `/api/v1/chat/context?query=${'a'.repeat(201)}`})
    expect(invalid.statusCode).toBe(400)
  })

  it('starts a real queued scan from a chat command and returns its run link', async () => {
    const scanStarter = { startScan: vi.fn().mockResolvedValue({ id: 'scan-28', status: 'QUEUED', targetDate: '2026-07-28' }) }
    const chatRepository = new MemoryChatRepository()
    const scanApp = await buildApp({ authRuntime: false, chatRepository, chatModel: model, chatKnowledge: knowledge, chatScanStarter: scanStarter })
    try {
      const sessionId = (await scanApp.inject({ method: 'POST', url: '/api/v1/chat/sessions' })).json<{ id: string }>().id
      const response = await scanApp.inject({
        method: 'POST', url: `/api/v1/chat/sessions/${sessionId}/messages`,
        payload: { content: '28 Temmuz 2026 taramasını başlat ve rapor oluştur' },
      })
      expect(response.statusCode).toBe(200)
      expect(scanStarter.startScan).toHaveBeenCalledWith({ targetDate: '2026-07-28', requestKey: expect.any(String) })
      expect(response.body).toContain('/runs/scan-28')
      expect(response.body).toContain('event: complete')
    } finally {
      await scanApp.close()
    }
  })

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
  it('lists only published reports for the correction picker', async () => {
    const report = { topicId: 'published', title: 'Tebliğ', version: 2, gazetteDate: '2026-10-09', card: 'K1', issueNumber: '1', summary: '', sourceUrl: 'https://example.com', reportUrl: '/reports/published', publishedAt: '2026-10-09T07:00:00Z' }
    vi.spyOn(knowledge, 'searchReports').mockResolvedValue([report, { ...report, topicId: 'empty-day', title: 'Değişiklik yok', card: 'K6', revisionEditable: true }, { ...report, topicId: 'pending', version: 0 }, { ...report, topicId: 'document-report', revisionEditable: false }])
    const response = await app.inject({ method: 'GET', url: '/api/v1/chat/reports' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ reports: [{ topicId: 'published', title: 'Tebliğ', version: 2, gazetteDate: '2026-10-09' },{topicId:'empty-day',title:'Değişiklik yok',version:2,gazetteDate:'2026-10-09'}] })
  })

})

it('keeps a turn running after disconnection and cancels only through the stop endpoint',async()=>{
 const {default:Fastify}=await import('fastify')
 const {chatRoutes}=await import('../../src/modules/chat/chat.routes')
 const repository=new MemoryChatRepository(),session=await repository.createSession()
 let release=()=>{},signal:AbortSignal|undefined
 const model:ChatModelClient={async *streamReply(input){
  signal=input.signal
  await new Promise<void>(resolve=>{release=resolve;input.signal?.addEventListener('abort',()=>resolve(),{once:true})})
  if(input.signal?.aborted)throw new Error('stopped')
  yield {type:'text',text:'Arka planda tamamlanan yanıt'}
 }}
 const server=Fastify()
 await server.register(chatRoutes,{repository,model,modelName:'test',knowledge,scanStarter:{} as never})
 const origin=await server.listen({port:0,host:'127.0.0.1'})
 try{
  const controller=new AbortController()
  const response=await fetch(`${origin}/sessions/${session.id}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'Kaynakları incele'}),signal:controller.signal})
  await response.body!.getReader().read()
  await expect.poll(()=>Boolean(signal)).toBe(true)
  controller.abort()
  const state=await (await fetch(`${origin}/sessions/${session.id}/messages`)).json() as any
  expect(state.active).not.toBeNull();expect(signal!.aborted).toBe(false)
  release()
  await expect.poll(async()=>((await (await fetch(`${origin}/sessions/${session.id}/messages`)).json()) as any).active).toBeNull()
  expect(repository.sessions.get(session.id)?.at(-1)?.content).toBe('Arka planda tamamlanan yanıt')
  signal=undefined
  const second=await fetch(`${origin}/sessions/${session.id}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'Başka bir soru'})})
  await second.body!.getReader().read()
  await expect.poll(()=>Boolean(signal)).toBe(true)
  expect((await fetch(`${origin}/sessions/${session.id}/stop`,{method:'POST'})).status).toBe(200)
  await expect.poll(()=>repository.sessions.get(session.id)?.at(-1)?.status).toBe('FAILED')
  expect(repository.sessions.get(session.id)?.at(-1)?.errorDetail).toContain('isteğiniz üzerine durduruldu')
 }finally{release();await server.close()}
})
