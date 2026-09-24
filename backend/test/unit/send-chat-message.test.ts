import { describe, expect, it, vi } from 'vitest'
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
  async getSessionTitle(): Promise<string | null> { return null }
  async setTitleIfMatches(): Promise<void> {}
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
  getRunContents: async () => ({
    runId: 'run-1', targetDate: '2026-09-21', status: 'COMPLETED', totalDocuments: 18,
    reports: [{ reportId: 'report-1', title: 'Değişiklik Yok', version: 1, reportUrl: '/runs/run-1/reports/report-1', sourceUrl: null }],
    relevantDocuments: [], gazetteIndexes: ['https://www.resmigazete.gov.tr/'],
  }),
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
  it('creates one template draft for an explicit request and returns its editor link', async () => {
    const repository = new MemoryChatRepository()
    const call = { type: 'tool-call' as const, call: { name: 'rapor_sablonu_taslagi_olustur', args: { istek: 'Karşılaştırma tablosu ve yönetici özeti ekle', hazirDuzen: 'detailed' } } }
    const model = new StubModel([], [[call, call], [{ type: 'text', text: '[Taslağı aç](/templates?id=template-1)' }]])
    const createTemplate = vi.fn(async () => ({ id: 'template-1', name: 'Yönetici şablonu' }))
    await collect(sendChatMessage({ sessionId: 's1', content: 'Yeni bir rapor şablonu oluştur, karşılaştırma tablosu ekle' }, { repository, model, modelName: 'gemini-test', knowledge, createTemplate }))
    expect(model.requests[0]!.tools?.some((tool) => tool.name === 'rapor_sablonu_taslagi_olustur')).toBe(true)
    expect(createTemplate).toHaveBeenCalledOnce()
    expect(model.requests[1]!.turns.at(-1)).toMatchObject({ role: 'tool-results', results: [
      { response: { url: '/templates?id=template-1', status: 'TASLAK' } },
      { response: { url: '/templates?id=template-1', status: 'TASLAK' } },
    ] })
  })
  it('starts a dated run once and returns its link when the user explicitly requests it', async () => {
    const repository = new MemoryChatRepository()
    const call = { type: 'tool-call' as const, call: { name: 'tarihli_tarama_baslat', args: { tarih: '2026-07-28' } } }
    const model = new StubModel([], [[call, call], [{ type: 'text', text: '28 Temmuz taraması kuyruğa alındı: [İncele](/runs/run-28).' }]])
    const startRun = vi.fn(async ({ targetDate }: { targetDate: string; requestKey: string }) => ({ id: 'run-28', status: 'QUEUED', targetDate }))

    const events = await collect(sendChatMessage({ sessionId: 's1', content: "28 Temmuz'a ait rapor oluşturma işlemi başlat" }, { repository, model, modelName: 'gemini-test', knowledge, startRun }))

    expect(startRun).toHaveBeenCalledOnce()
    expect(startRun).toHaveBeenCalledWith({ targetDate: '2026-07-28', requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    expect(model.requests[1]!.turns.at(-1)).toMatchObject({ role: 'tool-results', results: [
      { name: 'tarihli_tarama_baslat', response: { runId: 'run-28', runUrl: '/runs/run-28', status: 'QUEUED' } },
      { name: 'tarihli_tarama_baslat', response: { runId: 'run-28' } },
    ] })
    expect(events.at(-1)).toMatchObject({ type: 'complete' })
  })

  it('does not expose or execute the write tool for a report lookup', async () => {
    const repository = new MemoryChatRepository()
    const model = new StubModel([], [
      [{ type: 'tool-call', call: { name: 'tarihli_tarama_baslat', args: { tarih: '2026-07-28' } } }],
      [{ type: 'text', text: 'Tarama başlatmadım.' }],
    ])
    const startRun = vi.fn(async () => ({ id: 'unexpected', status: 'QUEUED', targetDate: '2026-07-28' }))

    await collect(sendChatMessage({ sessionId: 's1', content: '28 Temmuz raporunu göster' }, { repository, model, modelName: 'gemini-test', knowledge, startRun }))

    expect(model.requests[0]!.tools?.some((tool) => tool.name === 'tarihli_tarama_baslat')).toBe(false)
    expect(startRun).not.toHaveBeenCalled()
    expect(model.requests[1]!.turns.at(-1)).toMatchObject({ role: 'tool-results', results: [{ response: { hata: expect.stringContaining('açıkça bulunmuyor') } }] })
  })

  it('keeps the started run link when the model fails after the tool succeeds', async () => {
    const repository = new MemoryChatRepository()
    let round = 0
    const model: ChatModelClient = {
      async *streamReply() {
        round += 1
        if (round === 1) yield { type: 'tool-call', call: { name: 'tarihli_tarama_baslat', args: { tarih: '2026-07-28' } } }
        else throw new Error('provider unavailable')
      },
    }
    const startRun = vi.fn(async ({ targetDate }: { targetDate: string; requestKey: string }) => ({ id: 'run-28', status: 'QUEUED', targetDate }))

    const events = await collect(sendChatMessage({ sessionId: 's1', content: '28 Temmuz 2026 taramasını başlat' }, { repository, model, modelName: 'gemini-test', knowledge, startRun }))

    expect(startRun).toHaveBeenCalledOnce()
    expect(events.at(-1)).toMatchObject({ type: 'complete', message: { status: 'COMPLETED', content: expect.stringContaining('/runs/run-28') } })
  })

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

  it('never marks an empty model response as completed', async () => {
    const repository = new MemoryChatRepository()
    const model = new StubModel([], [[], []])

    const events = await collect(sendChatMessage({ sessionId: 's1', content: 'Raporu göster' }, { repository, model, modelName: 'gemini-test', knowledge }))

    expect(model.requests).toHaveLength(2)
    expect(repository.saved.at(-1)).toMatchObject({ role: 'ASSISTANT', status: 'FAILED', errorDetail: 'EMPTY_MODEL_RESPONSE' })
    expect(events.at(-1)).toMatchObject({ type: 'error' })
  })

  it('uses verified run results when the model finishes without text', async () => {
    const repository = new MemoryChatRepository()
    const model = new StubModel([], [
      [{ type: 'tool-call', call: { name: 'tarama_icerigi_getir', args: { runId: 'run-1' } } }],
      [],
      [],
    ])

    const events = await collect(sendChatMessage({ sessionId: 's1', content: 'Bu rundaki raporu göster' }, { repository, model, modelName: 'gemini-test', knowledge }))

    expect(repository.saved.at(-1)).toMatchObject({
      role: 'ASSISTANT', status: 'COMPLETED',
      content: expect.stringContaining('[Değişiklik Yok](/runs/run-1/reports/report-1)'),
    })
    expect(events.at(-1)).toMatchObject({ type: 'complete' })
    expect(repository.saved.at(-1)?.content).toContain('filtresinden geçen Resmî Gazete belgesi bulunmadı')
  })
})
