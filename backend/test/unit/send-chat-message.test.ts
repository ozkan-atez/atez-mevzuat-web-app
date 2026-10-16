import { describe, expect, it, vi } from 'vitest'
import { AiProviderError } from '../../src/modules/ai/domain/ai-errors'
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
  it('records explicit zero only for a completed answer with no AI call', async () => {
    const repository = new MemoryChatRepository(), model = new StubModel(), save = vi.fn()
    await collect(sendChatMessage({sessionId: 's1', content: '12 Ekim 2026 tarihli taramayı başlat'}, {repository, model, modelName: 'test', knowledge, usageRecorder: {save}, scanStarter: {startScan: async () => ({id: 'run-1', targetDate: '2026-10-12', status: 'QUEUED'})}}))
    expect(model.requests).toHaveLength(0)
    expect(save).toHaveBeenCalledWith(expect.objectContaining({conversationId: 's1', messageId: 'm1', mode: 'NO_MODEL', totalTokens: 0, inputTokens: 0, outputTokens: 0, status: 'COMPLETED'}))
  })
  it('associates every model round with the same user message', async () => {
    const repository = new MemoryChatRepository(), save = vi.fn()
    const model = new StubModel([], [[{type: 'tool-call', call: {name: 'unknown-tool', args: {}}}], [{type: 'text', text: 'Yanıt'}]])
    await collect(sendChatMessage({sessionId: 's1', content: 'Bir kavramı açıkla'}, {repository, model, modelName: 'test', knowledge, usageRecorder: {save}}))
    const calls = new Map(save.mock.calls.map(([call]) => [call.id, call]))
    expect(calls.size).toBe(2)
    for (const call of calls.values()) expect(call).toMatchObject({conversationId: 's1', messageId: 'm1', mode: 'CHAT', status: 'COMPLETED', totalTokens: null})
  })

  it.each(['browserAgent', 'webSearch'] as const)('rejects disabled %s before invoking any model or saving messages', async mode => {
    const repository=new MemoryChatRepository(), model=new StubModel()
    const run=vi.fn()
    const events=await collect(sendChatMessage({sessionId:'s1',content:'Araştır',[mode]:true},{repository,model,modelName:'test',knowledge,browserResearch:{run}}))
    expect(events).toEqual([{type:'error',message:expect.stringContaining('şu anda kapalı')}])
    expect(model.requests).toHaveLength(0)
    expect(repository.saved).toHaveLength(0)
    expect(run).not.toHaveBeenCalled()
  })
  it('starts a requested scan without waiting for the model to choose a tool', async () => {
    const repository = new MemoryChatRepository()
    const model = new StubModel()
    const scanStarter = { startScan: vi.fn().mockResolvedValue({ id: 'run-28', status: 'QUEUED', targetDate: '2026-07-28' }) }

    const events = await collect(sendChatMessage(
      { sessionId: 's1', content: '28 Temmuz 2026 için tarama ve rapor oluştur' },
      { repository, model, modelName: 'gemini-test', knowledge, scanStarter },
    ))

    expect(scanStarter.startScan).toHaveBeenCalledWith({ targetDate: '2026-07-28', requestKey: expect.any(String) })
    expect(model.requests).toHaveLength(0)
    expect(events).toContainEqual({ type: 'tool', name: 'tarama_baslat', label: 'Mevzuat taramasını başlatıyor' })
    expect(repository.saved.at(-1)?.content).toContain('/runs/run-28')
    expect(repository.saved.at(-1)?.content).toContain('Raporlar tarama tamamlandığında')
  })

  it('does not claim a run started when creation fails', async () => {
    const repository = new MemoryChatRepository()
    const events = await collect(sendChatMessage(
      { sessionId: 's1', content: '28 Temmuz 2026 taramasını başlat' },
      { repository, model: new StubModel(), modelName: 'gemini-test', knowledge,
        scanStarter: { startScan: async () => { throw new Error('database unavailable') } } },
    ))
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Tarama başlatılamadı. Lütfen yeniden deneyin.' })
    expect(repository.saved.at(-1)).toMatchObject({ status: 'FAILED', errorDetail: 'Tarama başlatılamadı. Lütfen yeniden deneyin.' })
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

  it('does not execute a provider tool call on the final answer round and reports the actual failure', async () => {
    const repository = new MemoryChatRepository()
    const searchReports = vi.fn(async () => [])
    const call = { type: 'tool-call' as const, call: { name: 'raporlari_ara', args: {} } }
    const model = new StubModel([], [[call], [call], [call], [call]])
    const events = await collect(sendChatMessage({ sessionId: 's1', content: 'Sor' }, { repository, model, modelName: 'test', knowledge: { searchReports } as unknown as AssistantKnowledge }))
    expect(searchReports).toHaveBeenCalledTimes(3)
    expect(model.requests.at(-1)?.toolMode).toBe('none')
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('Araştırma adımları sınırına') })
    expect(repository.saved.at(-1)?.status).toBe('FAILED')
  })

  it('returns all three historical tariff results in one round without unrelated data crowding them out', async () => {
    const repository = new MemoryChatRepository()
    const codes = ['690740000000', '691010000000', '691090000000']
    const model = new StubModel([], [codes.map(gtip => ({ type: 'tool-call' as const, call: { name: 'gtip_tariff_sorgula', args: { gtip, tarih: '2026-07-10', alan: 'birim_gumruk_kiymeti' } } })), [{ type: 'text', text: 'Üç GTİP için sonuçlar.' }]])
    const lookup = vi.fn(async (input: { code: string; date: string }) => ({ ...input, description: null, source: 'https://tariff.singlewindow.io/', fetchedAt: '', classification: 'SUPPORTING_NON_AUTHORITATIVE' as const, comparisons: [], notes: [] }))
    await collect(sendChatMessage({ sessionId: 's1', content: '11 Temmuz öncesi birim gümrük kıymeti' }, { repository, model, modelName: 'test', knowledge, tariffLookup: { lookup } }))
    expect(lookup).toHaveBeenCalledTimes(3)
    for (const code of codes) expect(lookup).toHaveBeenCalledWith({ code, date: '2026-07-10', compare: false })
    expect(model.requests[1]?.turns.at(-1)).toMatchObject({ role: 'tool-results', results: codes.map(code => ({ response: { code, date: '2026-07-10' } })) })
    expect(repository.saved.at(-1)?.status).toBe('COMPLETED')
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
  it('answers report queries with real data even when Gemini permission is denied', async () => {
    const repository = new MemoryChatRepository(); const model = new StubModel()
    model.error = new AiProviderError('PERMISSION', false, 'provider private text', 403)
    const events = await collect(sendChatMessage({ sessionId: 's1', content: 'son raporları göster' }, { repository, model, modelName: 'gemini-test', knowledge }))
    expect(model.requests).toHaveLength(0)
    expect(events.at(-1)?.type).toBe('complete')
    expect(repository.saved.at(-1)).toMatchObject({ status: 'COMPLETED', content: expect.stringContaining('İthalat Tebliği') })
  })
  it('stores and streams a readable permission error without a raw technical code', async () => {
    const repository = new MemoryChatRepository(); const model = new StubModel()
    model.error = new AiProviderError('PERMISSION', false, 'provider private text', 403)
    const events = await collect(sendChatMessage({ sessionId: 's1', content: 'Merhaba' }, { repository, model, modelName: 'gemini-test', knowledge }))
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('erişim reddedildi') })
    expect(repository.saved.at(-1)?.errorDetail).not.toContain('MODEL_GENERATION_FAILED')
    expect(repository.saved.at(-1)?.errorDetail).not.toContain('private text')
  })

  it('does not store an empty model output as a successful reply', async () => {
    const repository = new MemoryChatRepository(); const model = new StubModel([])
    const events = await collect(sendChatMessage({ sessionId: 's1', content: 'Merhaba' }, { repository, model, modelName: 'gemini-test', knowledge }))
    expect(events.at(-1)?.type).toBe('error')
    expect(repository.saved.at(-1)?.status).toBe('FAILED')
  })

})

it('uses selected sources and template without searching outside the selection', async () => {
  const repository = new MemoryChatRepository()
  repository.messages = [message('Unselected source evidence')]
  const model = new StubModel(['Kaynaklı özet'])
  const searchReports = vi.fn()
  const scrapeChatSource = vi.fn().mockResolvedValue({documents: [{title: 'Seçili kaynak', url: 'https://example.com', text: 'Seçili kanıt'}]})
  const getChatTemplate = vi.fn().mockResolvedValue({id: 'template-1', name: 'Yönetici Özeti', sections: [{heading: 'Etki', enabled: true}]})
  await collect(sendChatMessage({sessionId: 's1', content: 'Raporları özetle', sourceIds: ['source-1'], templateId: 'template-1'}, {repository, model, modelName: 'test', knowledge: {...knowledge, searchReports, scrapeChatSource, getChatTemplate}}))
  expect(scrapeChatSource).toHaveBeenCalledWith({id: 'source-1', query: 'Raporları özetle'})
  expect(getChatTemplate).toHaveBeenCalledWith('template-1')
  expect(searchReports).not.toHaveBeenCalled()
  expect(model.requests[0]?.tools).toBeUndefined()
  expect(JSON.stringify(model.requests[0]?.turns)).toContain('Seçili kanıt')
  expect(JSON.stringify(model.requests[0]?.turns)).toContain('Yönetici Özeti')
  expect(JSON.stringify(model.requests[0]?.turns)).not.toContain('Unselected source evidence')
})

 it('does not fall back to global tools or old evidence when a selected scraper fails',async()=>{
  const repository=new MemoryChatRepository(),model=new StubModel(['Kaynağa erişilemedi.'])
  const searchReports=vi.fn(),scrapeChatSource=vi.fn().mockRejectedValue(new Error('Unavailable'))
  repository.messages=[message('Eski kaynak kanıtı')]
  await collect(sendChatMessage({sessionId:'s1',content:'Özetle',sourceIds:['s1']},{repository,model,modelName:'test',knowledge:{...knowledge,searchReports,scrapeChatSource}}))
  expect(searchReports).not.toHaveBeenCalled()
  expect(model.requests[0]?.tools).toBeUndefined()
  expect(JSON.stringify(model.requests[0]?.turns)).toContain('başka kaynağa geçme')
  expect(JSON.stringify(model.requests[0]?.turns)).not.toContain('Eski kaynak kanıtı')
 })

it('persists an interrupted answer so returning to the chat explains the gap',async()=>{
  const repository=new MemoryChatRepository(),controller=new AbortController()
  const model:ChatModelClient={async *streamReply(){controller.abort(new Error('CLIENT_DISCONNECTED'));throw new Error('aborted')}}
  await collect(sendChatMessage({sessionId:'s',content:'Bir sorum var',signal:controller.signal},{repository,model,modelName:'test',knowledge}))
  expect(repository.saved.at(-1)).toMatchObject({role:'ASSISTANT',status:'FAILED',errorDetail:expect.stringContaining('bağlantı kapandı')})
  expect(repository.saved.at(-1)?.errorDetail).toContain('Takip: m1')
})
