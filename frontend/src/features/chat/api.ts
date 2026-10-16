import { apiFetch } from '../../lib/apiFetch'
import type { ChatHistoryItem, ChatMessage, ChatSession, ChatStreamEvent, ChatSendOptions } from './types'

export class ChatApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ChatApiError'
    this.status = status
  }

  static async from(response: Response, fallback: string): Promise<ChatApiError> {
    const message = await response.json().then(
      (body: unknown) => (body && typeof body === 'object' && 'message' in body ? String(body.message) : fallback),
      () => fallback,
    )
    return new ChatApiError(response.status, message)
  }
}

export async function listChatHistory(signal?: AbortSignal): Promise<ChatHistoryItem[]> {
  const response = await apiFetch('/api/v1/chat/sessions', signal ? { signal } : {})
  if (!response.ok) throw await ChatApiError.from(response, 'Sohbet geçmişi alınamadı.')
  return ((await response.json()) as { sessions: ChatHistoryItem[] }).sessions
}

export async function createChatSession(): Promise<ChatSession> {
  const response = await apiFetch('/api/v1/chat/sessions', { method: 'POST' })
  if (!response.ok) throw await ChatApiError.from(response, 'Sohbet başlatılamadı.')
  return response.json() as Promise<ChatSession>
}

export async function getChatMessages(sessionId: string, signal?: AbortSignal): Promise<ChatMessage[]> {
  const response = await apiFetch(`/api/v1/chat/sessions/${sessionId}/messages`, signal ? { signal } : {})
  if (!response.ok) throw await ChatApiError.from(response, 'Mesajlar alınamadı.')
  return ((await response.json()) as { messages: ChatMessage[] }).messages
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const response = await apiFetch(`/api/v1/chat/sessions/${sessionId}`, { method: 'DELETE' })
  if (!response.ok) throw await ChatApiError.from(response, 'Sohbet silinemedi.')
}

export async function streamChatMessage(sessionId: string, content: string, signal: AbortSignal, documentVersionIds: string[] = [], options:ChatSendOptions = {}): Promise<Response> {
  return apiFetch(`/api/v1/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, ...(options.sourceIds?.length ? {sourceIds: options.sourceIds} : {}), ...(options.templateId ? {templateId: options.templateId} : {}), ...(options.webSearch ? {webSearch:true}:{}), ...(options.browserAgent ? {browserAgent:true}:{}), ...(documentVersionIds.length ? { documentVersionIds } : {}) }),
    signal,
  })
}

/**
 * Reads the SSE response as typed events.
 *
 * Network chunks do not line up with event frames — one chunk can split a frame
 * in half or carry three of them — so bytes are buffered until a blank line
 * proves a frame is complete.
 */
export async function* parseChatEventStream(response: Response): AsyncGenerator<ChatStreamEvent> {
  if (!response.ok || !response.body) throw await ChatApiError.from(response, 'Yanıt alınamadı.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let terminal = false

  try {
    for (;;) {
      let timer:ReturnType<typeof setTimeout>|undefined
      const {done,value}=await Promise.race([
        reader.read(),
        new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new ChatApiError(504,'Sunucudan yanıt akışı alınamıyor. Bağlantıyı kontrol edip yeniden deneyin.')),45000)}),
      ]).finally(()=>clearTimeout(timer))
      buffer += decoder.decode(value, { stream: !done })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const data = frame.split('\n').find((line) => line.startsWith('data: '))?.slice(6)
        if (data) {
          const event=JSON.parse(data) as ChatStreamEvent
          if(event.type==='complete' || event.type==='error')terminal=true
          yield event
        }
      }
      if (done) {
        if(!terminal)throw new ChatApiError(502,'Yanıt tamamlanmadan bağlantı kesildi. Mesajınız kaydedildi; yeniden deneyebilirsiniz.')
        break
      }
    }
  } finally {
    if(!terminal)void reader.cancel().catch(()=>undefined)
    reader.releaseLock()
  }
}

export interface ChatReportOption { topicId: string; title: string; version: number; gazetteDate: string }
export async function listChatReports(): Promise<ChatReportOption[]> {
  const response = await apiFetch('/api/v1/chat/reports')
  if (!response.ok) throw await ChatApiError.from(response, 'Düzeltilebilecek raporlar alınamadı.')
  return ((await response.json()) as { reports: ChatReportOption[] }).reports
}

export interface ReportThread {
  reportId: string; topicId: string | null; title: string; latestVersion: number
  messages: ChatMessage[]
  revisions: Array<{version: number; createdAt: string; createdBy?: string | null; createdByName?: string | null}>
}
export async function getReportThread(id: string, signal?: AbortSignal): Promise<ReportThread> {
  const response = await apiFetch(`/api/v1/chat/report-threads/${encodeURIComponent(id)}`, signal ? {signal} : {})
  if (!response.ok) throw await ChatApiError.from(response, 'Rapor sohbeti alınamadı.')
  return response.json()
}

export interface ChatActivity {startedAt:number;stage:string;content:string;stopping:boolean}
export async function getChatState(sessionId:string,signal?:AbortSignal):Promise<{messages:ChatMessage[];active:ChatActivity|null}> {
  const response=await apiFetch(`/api/v1/chat/sessions/${sessionId}/messages`,signal?{signal}:{})
  if(!response.ok)throw await ChatApiError.from(response,'Sohbet durumu alınamadı.')
  const data=await response.json()
  return {messages:data.messages,active:data.active??null}
}
export async function stopChatMessage(sessionId:string):Promise<void> {
  const response=await apiFetch(`/api/v1/chat/sessions/${sessionId}/stop`,{method:'POST'})
  if(!response.ok)throw await ChatApiError.from(response,'İşlem durdurulamadı.')
}
