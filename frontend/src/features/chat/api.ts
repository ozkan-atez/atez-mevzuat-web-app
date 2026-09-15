import type { ChatHistoryItem, ChatMessage, ChatSession, ChatStreamEvent } from './types'

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
  const response = await fetch('/api/v1/chat/sessions', signal ? { signal } : {})
  if (!response.ok) throw await ChatApiError.from(response, 'Sohbet geçmişi alınamadı.')
  return ((await response.json()) as { sessions: ChatHistoryItem[] }).sessions
}

export async function createChatSession(): Promise<ChatSession> {
  const response = await fetch('/api/v1/chat/sessions', { method: 'POST' })
  if (!response.ok) throw await ChatApiError.from(response, 'Sohbet başlatılamadı.')
  return response.json() as Promise<ChatSession>
}

export async function getChatMessages(sessionId: string, signal?: AbortSignal): Promise<ChatMessage[]> {
  const response = await fetch(`/api/v1/chat/sessions/${sessionId}/messages`, signal ? { signal } : {})
  if (!response.ok) throw await ChatApiError.from(response, 'Mesajlar alınamadı.')
  return ((await response.json()) as { messages: ChatMessage[] }).messages
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const response = await fetch(`/api/v1/chat/sessions/${sessionId}`, { method: 'DELETE' })
  if (!response.ok) throw await ChatApiError.from(response, 'Sohbet silinemedi.')
}

export async function streamChatMessage(sessionId: string, content: string, signal: AbortSignal): Promise<Response> {
  return fetch(`/api/v1/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
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

  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const data = frame.split('\n').find((line) => line.startsWith('data: '))?.slice(6)
        if (data) yield JSON.parse(data) as ChatStreamEvent
      }
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }
}
