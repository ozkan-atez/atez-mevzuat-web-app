import { describe, expect, it } from 'vitest'
import { sendChatMessage } from '../../src/modules/chat/application/send-chat-message'
import { wantsChatReport } from '../../src/modules/chat/application/create-chat-report'
import { HttpComponentStudio, type ComponentDraftCard, type ComponentStudio } from '../../src/modules/chat/application/component-studio'
import type { ChatModelChunk, ChatModelClient, ChatModelRequest, ChatStreamEvent } from '../../src/modules/chat/application/chat-model-client'
import type { AssistantKnowledge } from '../../src/modules/chat/application/assistant-knowledge'
import type { AppendChatMessageInput, ChatHistoryItem, ChatMessageView, ChatRepository, ChatSessionView } from '../../src/modules/chat/application/ports'

class Repo implements ChatRepository {
  messages: ChatMessageView[] = []
  saved: AppendChatMessageInput[] = []
  async createSession(): Promise<ChatSessionView> { throw new Error('unused') }
  async sessionExists() { return true }
  async getMessages() { return this.messages }
  async listHistory(): Promise<ChatHistoryItem[]> { return [] }
  async deleteSession() { return true }
  async appendMessage(input: AppendChatMessageInput): Promise<ChatMessageView> {
    this.saved.push(input)
    const view: ChatMessageView = { id: `m${this.messages.length + 1}`, role: input.role, content: input.content, status: input.status, errorDetail: input.errorDetail ?? null, createdAt: new Date().toISOString(), ...(input.context ? { context: input.context } : {}) }
    this.messages = [...this.messages, view]
    return view
  }
}
class Model implements ChatModelClient {
  requests: ChatModelRequest[] = []
  constructor(private readonly rounds: ChatModelChunk[][]) {}
  async *streamReply(input: ChatModelRequest): AsyncIterable<ChatModelChunk> {
    this.requests.push(input)
    for (const c of this.rounds[this.requests.length - 1] ?? []) yield c
  }
}
class Studio implements ComponentStudio {
  drafts: { request: string; base: unknown }[] = []
  async listComponents() { return [{ id: 'c1', key: 'yururluk', name: 'Yürürlük', description: 'Tarihler', category: 'ZAMAN_CIZELGESI', status: 'ACTIVE', origin: 'BUILTIN', currentVersion: 3 }] }
  async getComponent(id: string) { return id === 'c1' ? { ...(await this.listComponents())[0]!, definition: { schemaVersion: 1, nodes: ['eski'] } } : null }
  async draft(input: { request: string; base: unknown }) {
    this.drafts.push(input)
    return { ok: true, reply: 'Eylem kutusu tasarladım.', name: 'Eylem kutusu', description: 'Adımlar', category: 'NOT_UYARI', definition: { schemaVersion: 1, nodes: ['yeni'] }, issues: [], previewHtml: '<html>önizleme</html>' }
  }
}
const knowledge = { searchReports: async () => [] } as unknown as AssistantKnowledge
async function collect(events: AsyncGenerator<ChatStreamEvent>) { const out: ChatStreamEvent[] = []; for await (const e of events) out.push(e); return out }
const call = (name: string, args: Record<string, unknown>): ChatModelChunk => ({ type: 'tool-call', call: { name, args } })

describe('sohbetten bileşen oluşturma', () => {
  it('"rapor bileşeni oluştur" rapor üretim isteği sayılmaz', () => {
    expect(wantsChatReport('Raporlar için yürürlük tarihini öne çıkaran bir rapor bileşeni oluştur')).toBe(false)
    expect(wantsChatReport('Bugünkü kaynaklardan rapor oluştur')).toBe(true)
  })

  it('model bilesen_olustur çağırır; taslak kartı mesaj bağlamına kaydedilir, modele yalnızca özet döner', async () => {
    const repo = new Repo(), studio = new Studio()
    const model = new Model([[call('bilesen_olustur', { istek: 'Firmaların yapacaklarını listeleyen eylem kutusu' })], [{ type: 'text', text: 'Eylem kutusu taslağı hazır; karttan kaydedebilirsiniz.' }]])
    const events = await collect(sendChatMessage({ sessionId: 's1', content: 'Firmaların yapacaklarını listeleyen bir eylem kutusu bileşeni oluştur' }, { repository: repo, model, modelName: 't', knowledge, componentStudio: studio }))
    expect(events).toContainEqual({ type: 'tool', name: 'bilesen_olustur', label: 'Bileşen taslağı hazırlıyor' })
    const complete = events.find((e) => e.type === 'complete') as Extract<ChatStreamEvent, { type: 'complete' }>
    const card = complete.message.context!.componentDrafts![0]!
    expect(card).toMatchObject({ name: 'Eylem kutusu', ok: true, previewHtml: '<html>önizleme</html>', definition: { nodes: ['yeni'] } })
    expect(card.target).toBeUndefined()
    const toolResult = JSON.stringify(model.requests[1]!.turns.at(-1))
    expect(toolResult).toContain(card.id)
    expect(toolResult).not.toContain('<html>') // HTML ve tanım modele gitmez
    expect(toolResult).not.toContain('yeni')
    expect(model.requests[0]!.systemInstruction).toMatch(/bilesen_olustur/)
  })

  it('takip mesajı geçmişteki taslağı temel alır; bilesen_degistir mevcut bileşeni hedefler', async () => {
    const repo = new Repo(), studio = new Studio()
    const prior: ComponentDraftCard = { id: 'd1', ok: true, name: 'Eylem kutusu', description: 'Adımlar', category: 'NOT_UYARI', definition: { nodes: ['ilk'] }, issues: [], previewHtml: null }
    repo.messages = [{ id: 'm0', role: 'ASSISTANT', content: 'Hazır', status: 'COMPLETED', errorDetail: null, createdAt: '', context: { componentDrafts: [prior] } }]
    const model = new Model([[call('bilesen_olustur', { istek: 'başlığa rozet ekle', oncekiTaslakId: 'd1' }), call('bilesen_degistir', { bilesenAnahtari: 'yururluk', istek: 'tarihi büyüt' })], [{ type: 'text', text: 'Tamam.' }]])
    const events = await collect(sendChatMessage({ sessionId: 's1', content: 'Başlığa rozet ekle ve yürürlük bileşeninde tarihi büyüt' }, { repository: repo, model, modelName: 't', knowledge, componentStudio: studio }))
    expect(studio.drafts[0]!.base).toMatchObject({ name: 'Eylem kutusu', definition: { nodes: ['ilk'] } })
    expect(studio.drafts[1]!.base).toMatchObject({ name: 'Yürürlük', definition: { nodes: ['eski'] } })
    const cards = (events.find((e) => e.type === 'complete') as Extract<ChatStreamEvent, { type: 'complete' }>).message.context!.componentDrafts!
    expect(cards).toHaveLength(2)
    expect(cards.find((c) => c.target)?.target).toEqual({ id: 'c1', key: 'yururluk', name: 'Yürürlük', version: 3, origin: 'BUILTIN' })
  })

  it('stüdyo yapılandırılmamışsa araç "kullanılamıyor" döner', async () => {
    const repo = new Repo()
    const model = new Model([[call('bilesen_olustur', { istek: 'tablo' })], [{ type: 'text', text: 'Şu an oluşturamıyorum.' }]])
    await collect(sendChatMessage({ sessionId: 's1', content: 'Bir tablo bileşeni oluştur' }, { repository: repo, model, modelName: 't', knowledge }))
    expect(JSON.stringify(model.requests[1]!.turns.at(-1))).toContain('kullanilamiyor')
  })

  it('HTTP istemcisi v2 uçlarını çağırır ve hatayı güvenli mesaja çevirir', async () => {
    const seen: string[] = []
    const studio = new HttpComponentStudio({ baseUrl: 'http://v2.local/', fetcher: (async (url: string, init: RequestInit) => {
      seen.push(`${init.method} ${url}`)
      if (url.endsWith('/ai/draft')) return new Response(JSON.stringify({ message: 'AI yapılandırılmamış' }), { status: 409 })
      return new Response(JSON.stringify([]), { status: 200 })
    }) as unknown as typeof fetch })
    await studio.listComponents()
    await expect(studio.draft({ request: 'x', base: null })).rejects.toThrow('AI yapılandırılmamış')
    expect(seen).toEqual(['GET http://v2.local/api/components', 'POST http://v2.local/api/components/ai/draft'])
  })
})
