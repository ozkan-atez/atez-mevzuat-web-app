import { useCallback, useEffect, useRef, useState } from 'react'
import { getChatState, stopChatMessage, parseChatEventStream, streamChatMessage } from './api'
import { MAX_MESSAGE_LENGTH, type ChatMessage, type ChatStreamEvent, type ChatSendOptions } from './types'

export const STREAMING_MESSAGE_ID = 'streaming-assistant'

export interface Conversation {
  messages: ChatMessage[]
  isLoading: boolean
  isSending: boolean
  /** What the assistant is looking up right now, if anything. */
  activity: string | null
  error: string | null
  send: (content: string, documentVersionIds?: string[], options?:ChatSendOptions) => Promise<void>
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
  const sending = useRef(false)
  const generation=useRef(0)
  const currentSession=useRef(sessionId)
  currentSession.current=sessionId
  const sendController = useRef<AbortController | null>(null)
  const loadController = useRef<AbortController | null>(null)

  useEffect(() => {
    sendController.current?.abort()
    sendController.current=null
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
    let timer:ReturnType<typeof setTimeout>
    const load=async()=>{
      const version=generation.current
      try{
        if(sendController.current)return
        const loaded=await getChatState(sessionId,controller.signal)
        if(controller.signal.aborted || sendController.current || version!==generation.current)return
        sending.current=Boolean(loaded.active)
        setIsSending(Boolean(loaded.active))
        setActivity(loaded.active?(loaded.active.stopping?'İşlem durduruluyor':loaded.active.stage):null)
        setMessages(loaded.active?[...loaded.messages,{...streamingPlaceholder(),content:loaded.active.content}]:loaded.messages)
      }catch(caught){if(!controller.signal.aborted)setError(caught instanceof Error?caught.message:'Mesajlar alınamadı.')}
      finally{if(!controller.signal.aborted){setIsLoading(false);timer=setTimeout(()=>void load(),2000)}}
    }
    void load()
    return ()=>{controller.abort();clearTimeout(timer)}
  }, [sessionId])

  // Detach the browser stream on navigation; server work continues independently.
  useEffect(() => () => sendController.current?.abort(), [])

  const send = useCallback(async (raw: string, documentVersionIds: string[] = [], options:ChatSendOptions = {}) => {
    const content = raw.trim()
    if (!sessionId || sending.current || content.length === 0 || content.length > MAX_MESSAGE_LENGTH) return
    sending.current = true
    generation.current++
    setIsSending(true)
    setError(null)
    setActivity('Yanıt hazırlanıyor')
    // A transcript request already in flight is now stale — a freshly created
    // conversation answers it as empty, which would wipe the message being sent.
    setIsLoading(false)
    const optimisticId = `optimistic-${crypto.randomUUID()}`
    setMessages((current) => [...current, optimistic(optimisticId, content), streamingPlaceholder()])
    const controller = new AbortController()
    sendController.current = controller

    try {
      const response = await streamChatMessage(sessionId, content, controller.signal, documentVersionIds, options)
      for await (const event of parseChatEventStream(response)) {
        setMessages((current) => reduceChatEvent(current, event, optimisticId))
        if (event.type === 'tool') setActivity(event.label)
        // Once words start arriving the lookup is over and the text speaks for itself.
        if (event.type === 'delta') setActivity(null)
        // Stream errors are already rendered as failed messages in the transcript.
      }
    } catch (caught: unknown) {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : 'Yanıt alınamadı.')
        setMessages((current) => current.map(message=>message.id===STREAMING_MESSAGE_ID?{...message,status:'FAILED',errorDetail:caught instanceof Error?caught.message:'Yanıt tamamlanamadı.'}:message))
      }
    } finally {
      if (sendController.current === controller) {
        sending.current = false
        setActivity(null)
        if (!controller.signal.aborted) setIsSending(false)
        sendController.current = null
      }
    }
  }, [sessionId])

  const stop=useCallback(()=>{
    if(!sessionId)return
    setActivity('İşlem durduruluyor')
    void stopChatMessage(sessionId).then(()=>{
      if(currentSession.current!==sessionId)return
      // Only explicit stop reaches the cancellation endpoint. Detaching SSE is separate.
      sendController.current?.abort()
      sendController.current=null
      sending.current=true
      setIsSending(true);setActivity('İşlem durduruluyor')
      setMessages(current=>current.map(message=>message.id===STREAMING_MESSAGE_ID?{...message,id:`stopped-${crypto.randomUUID()}`,content:message.content ? message.content+'\n\nİşlem isteğiniz üzerine durduruldu.' : 'İşlem isteğiniz üzerine durduruldu.'}:message))
    }).catch(caught=>setError(caught instanceof Error?caught.message:'İşlem durdurulamadı.'))
  },[sessionId])
  const clearError = useCallback(() => setError(null), [])

  return { messages, isLoading, isSending, activity, error, send, stop, clearError }
}
