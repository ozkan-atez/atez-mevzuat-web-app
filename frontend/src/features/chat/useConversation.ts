import { useCallback, useEffect, useRef, useState } from 'react'
import { getChatMessages, parseChatEventStream, streamChatMessage } from './api'
import { MAX_MESSAGE_LENGTH, type ChatMessage, type ChatStreamEvent } from './types'

export const STREAMING_MESSAGE_ID = 'streaming-assistant'

export interface Conversation {
  messages: ChatMessage[]
  isLoading: boolean
  isSending: boolean
  error: string | null
  send: (content: string) => Promise<void>
  clearError: () => void
}

function optimistic(id: string, content: string): ChatMessage {
  return { id, role: 'USER', content, status: 'COMPLETED', errorDetail: null, createdAt: new Date().toISOString() }
}

function streamingPlaceholder(): ChatMessage {
  return { id: STREAMING_MESSAGE_ID, role: 'ASSISTANT', content: '', status: 'COMPLETED', errorDetail: null, createdAt: new Date().toISOString() }
}

/** Folds one server event into the visible transcript. */
export function reduceChatEvent(messages: ChatMessage[], event: ChatStreamEvent, optimisticId: string): ChatMessage[] {
  switch (event.type) {
    case 'message':
      return messages.map((message) => (message.id === optimisticId ? event.message : message))
    case 'delta':
      return messages.map((message) => (
        message.id === STREAMING_MESSAGE_ID ? { ...message, content: message.content + event.content } : message
      ))
    case 'complete':
      return messages.map((message) => (message.id === STREAMING_MESSAGE_ID ? event.message : message))
    case 'error':
      return messages.map((message) => (
        message.id === STREAMING_MESSAGE_ID
          ? { ...message, status: 'FAILED', errorDetail: event.message }
          : message
      ))
  }
}

export function useConversation(sessionId: string | undefined): Conversation {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A ref, not the state: two submits in the same tick would both read `false`.
  const sending = useRef(false)
  const sendController = useRef<AbortController | null>(null)
  const loadController = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setMessages([])
      return
    }
    const controller = new AbortController()
    loadController.current = controller
    setIsLoading(true)
    getChatMessages(sessionId, controller.signal)
      .then((loaded) => { if (!controller.signal.aborted) setMessages(loaded) })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'Mesajlar alınamadı.')
      })
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false) })
    return () => controller.abort()
  }, [sessionId])

  // Leaving the page must stop the request; an orphaned stream would keep writing
  // into a transcript nobody is looking at.
  useEffect(() => () => sendController.current?.abort(), [])

  const send = useCallback(async (raw: string) => {
    const content = raw.trim()
    if (!sessionId || sending.current || content.length === 0 || content.length > MAX_MESSAGE_LENGTH) return
    sending.current = true
    setIsSending(true)
    setError(null)
    // A transcript request already in flight is now stale — a freshly created
    // conversation answers it as empty, which would wipe the message being sent.
    loadController.current?.abort()
    setIsLoading(false)
    const optimisticId = `optimistic-${crypto.randomUUID()}`
    setMessages((current) => [...current, optimistic(optimisticId, content), streamingPlaceholder()])
    const controller = new AbortController()
    sendController.current = controller

    try {
      const response = await streamChatMessage(sessionId, content, controller.signal)
      for await (const event of parseChatEventStream(response)) {
        setMessages((current) => reduceChatEvent(current, event, optimisticId))
        if (event.type === 'error') setError(event.message)
      }
    } catch (caught: unknown) {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : 'Yanıt alınamadı.')
        setMessages((current) => current.filter((message) => message.id !== STREAMING_MESSAGE_ID))
      }
    } finally {
      sending.current = false
      if (!controller.signal.aborted) setIsSending(false)
      sendController.current = null
    }
  }, [sessionId])

  const clearError = useCallback(() => setError(null), [])

  return { messages, isLoading, isSending, error, send, clearError }
}
