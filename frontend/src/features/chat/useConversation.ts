import { useCallback, useEffect, useRef, useState } from 'react'
import { getChatMessages, parseChatEventStream, streamChatMessage } from './api'
import { MAX_MESSAGE_LENGTH, type ChatMessage, type ChatStreamEvent, type ChatSendOptions } from './types'

export const STREAMING_MESSAGE_ID = 'streaming-assistant'

export interface Conversation {
  messages: ChatMessage[]
  isLoading: boolean
  isSending: boolean
  /** What the assistant is looking up right now, if anything. */
  activity: string | null
  error: string | null
  send: (content: string, documentVersionIds?: string[], options?:ChatSendOptions) => Promise<boolean | void>
  stop:()=>void
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
    case 'tool':
      return messages
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
  const [activity, setActivity] = useState<string | null>(null)
  // A ref, not the state: two submits in the same tick would both read `false`.
  const pendingRequest=useRef<{fingerprint:string;key:string}|null>(null)
  const sending = useRef(false)
  const sendController = useRef<AbortController | null>(null)
  const loadController = useRef<AbortController | null>(null)

  useEffect(() => {
    sendController.current?.abort()
    sending.current = false
    setIsSending(false)
    setMessages([])
    setError(null)
    setActivity(null)
    if (!sessionId) {
      setIsLoading(false)
      loadController.current = null
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

  const send = useCallback(async (raw: string, documentVersionIds: string[] = [], options:ChatSendOptions = {}) => {
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

    let success=false
    try {
      const fingerprint=JSON.stringify([sessionId,content,documentVersionIds,options.context])
      if(pendingRequest.current?.fingerprint!==fingerprint)pendingRequest.current={fingerprint,key:crypto.randomUUID()}
      const response = await streamChatMessage(sessionId, content, controller.signal, documentVersionIds, {...options,requestKey:pendingRequest.current.key})
      for await (const event of parseChatEventStream(response)) {
        setMessages((current) => reduceChatEvent(current, event, optimisticId))
        if(event.type==='complete')success=true
        if(event.type==='error')success=false
        if (event.type === 'tool') setActivity(event.label)
        // Once words start arriving the lookup is over and the text speaks for itself.
        if (event.type === 'delta') setActivity(null)
        // Stream errors are already rendered as failed messages in the transcript.
      }
    } catch (caught: unknown) {
      success=false
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : 'Yanıt alınamadı.')
        setMessages((current) => current.filter((message) => message.id !== STREAMING_MESSAGE_ID))
      }
    } finally {
      if (sendController.current === controller) {
        sending.current = false
        setActivity(null)
        if (!controller.signal.aborted) setIsSending(false)
        sendController.current = null
      }
    }
    if(success)pendingRequest.current=null
    return success
  }, [sessionId])

  const stop=useCallback(()=>{
    sendController.current?.abort()
    sending.current=false
    setIsSending(false);setActivity(null)
    setMessages(current=>current.map(message=>message.id===STREAMING_MESSAGE_ID?{...message,id:`stopped-${crypto.randomUUID()}`,content:message.content ? message.content+'\n\nYanıt durduruldu.' : 'Araştırma durduruldu.'}:message))
  },[])
  const clearError = useCallback(() => setError(null), [])

  return { messages, isLoading, isSending, activity, error, send, stop, clearError }
}
