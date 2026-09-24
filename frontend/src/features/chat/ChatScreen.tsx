import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Menu, Plus, X } from 'lucide-react'
import { DockedAiAssistant } from './DockedAiAssistant'
import { ConversationHistory } from './ConversationHistory'
import { ConversationMessages } from './ConversationMessages'
import { createChatSession, deleteChatSession, listChatHistory } from './api'
import { useConversation } from './useConversation'
import type { ChatHistoryItem } from './types'

interface ChatLocationState {
  initialMessage?: string
  initialFile?: File
}

export function ChatScreen() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const initialMessage = (location.state as ChatLocationState | null)?.initialMessage?.trim() ?? ''
  const initialFile = (location.state as ChatLocationState | null)?.initialFile

  const [history, setHistory] = useState<ChatHistoryItem[]>([])
  const [isHistoryLoading, setIsHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isAssistantOpen, setIsAssistantOpen] = useState(true)
  const [handoffError, setHandoffError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  const conversation = useConversation(sessionId)

  const loadHistory = useCallback(async (silent = false) => {
    if (!silent) {
      setIsHistoryLoading(true)
      setHistoryError(null)
    }
    try {
      setHistory(await listChatHistory())
    } catch (caught: unknown) {
      if (!silent) setHistoryError(caught instanceof Error ? caught.message : 'Sohbet geçmişi alınamadı.')
    } finally {
      if (!silent) setIsHistoryLoading(false)
    }
  }, [])

  useEffect(() => { void loadHistory() }, [loadHistory])

  // One conversation per handoff: React may run this effect twice (StrictMode, a
  // rerender), and a second session would strand the first message.
  const creating = useRef(false)
  const handedOff = useRef(false)
  useEffect(() => {
    if (!sessionId && !initialMessage) {
      creating.current = false
      handedOff.current = false
    }
  }, [sessionId, initialMessage])

  const startConversation = useCallback((content: string, file?: File) => {
    if (creating.current || !content.trim()) return
    creating.current = true
    setIsCreating(true)
    setHandoffError(null)
    createChatSession()
      .then((session) => {
        setIsCreating(false)
        navigate(`/chat/${session.id}`, { replace: true, state: { initialMessage: content.trim(), ...(file ? { initialFile: file } : {}) }, viewTransition: true })
      })
      .catch((caught: unknown) => {
        creating.current = false
        setIsCreating(false)
        setHandoffError(caught instanceof Error ? caught.message : 'Sohbet başlatılamadı.')
      })
  }, [navigate])

  useEffect(() => {
    if (sessionId || !initialMessage) return
    startConversation(initialMessage, initialFile)
  }, [initialMessage, initialFile, sessionId, startConversation])

  // The handed-over message is sent exactly once, and the router state is cleared
  // so a refresh or a back-navigation cannot resend it.
  useEffect(() => {
    if (!sessionId || handedOff.current || !initialMessage) return
    handedOff.current = true
    navigate(`/chat/${sessionId}`, { replace: true, state: null })
    void conversation.send(initialMessage, initialFile)
  }, [conversation, initialMessage, initialFile, navigate, sessionId])

  const handleDelete = useCallback(async (id: string) => {
    if (!window.confirm('Bu sohbet kalıcı olarak silinsin mi?')) return
    try {
      await deleteChatSession(id)
      setHistory((current) => current.filter((item) => item.id !== id))
      if (id === sessionId) navigate('/chat', { replace: true })
    } catch (caught: unknown) {
      setHistoryError(caught instanceof Error ? caught.message : 'Sohbet silinemedi.')
    }
  }, [navigate, sessionId])

  // Refresh the conversation title after a reply completes.
  const wasSending = useRef(false)
  useEffect(() => {
    if (wasSending.current && !conversation.isSending) void loadHistory()
    wasSending.current = conversation.isSending
  }, [conversation.isSending, loadHistory])

  const pendingTitleIds = history.filter((item) => item.type === 'GENERAL' && (item.titlePending || item.title === 'Yeni sohbet') && item.messageCount > 0).map((item) => item.id).join(',')
  useEffect(() => {
    if (!pendingTitleIds) return
    const interval = window.setInterval(() => { void loadHistory(true) }, 2_000)
    const timeout = window.setTimeout(() => window.clearInterval(interval), 30_000)
    return () => { window.clearInterval(interval); window.clearTimeout(timeout) }
  }, [pendingTitleIds, loadHistory])

  const activeRunIds = history.filter((item) => item.run?.status === 'RUNNING').map((item) => item.run!.id).join(',')
  useEffect(() => {
    if (!activeRunIds) return
    const interval = window.setInterval(() => { void loadHistory(true) }, 15_000)
    return () => window.clearInterval(interval)
  }, [activeRunIds, loadHistory])

  // On the empty state there is no conversation yet, so the first message opens
  // one and is sent through the same handoff the dashboard uses.
  const send = (content: string, file?: File) => {
    if (sessionId) void conversation.send(content, file)
    else startConversation(content, file)
  }

  const historyPanel = (
    <ConversationHistory
      items={history}
      activeId={sessionId}
      isLoading={isHistoryLoading}
      error={historyError}
      onRetry={() => void loadHistory()}
      onDelete={(id) => void handleDelete(id)}
      onNavigate={() => setIsDrawerOpen(false)}
    />
  )

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-6 pt-6 sm:px-6 sm:pb-10 sm:pt-10 lg:px-8">
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <button type="button" aria-label="Geçmişi kapat" onClick={() => setIsDrawerOpen(false)} className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
          <div className="relative flex h-full w-72 flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
              <h2 className="text-base font-bold text-slate-900">Sohbet geçmişi</h2>
              <button type="button" aria-label="Geçmişi kapat" onClick={() => setIsDrawerOpen(false)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            {historyPanel}
          </div>
        </div>
      )}

      <header className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-5 shadow-sm sm:gap-4 sm:px-6">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-slate-900 sm:text-xl">Sohbet geçmişi</h1>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm">Mevzuat asistanıyla yaptığınız konuşmalar</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link to="/chat" aria-label="Yeni sohbet" onClick={() => setIsDrawerOpen(false)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1b2a4a] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2b406a] sm:px-4">
            <Plus className="h-4 w-4" aria-hidden="true" /><span className="sm:hidden">Yeni</span><span className="hidden sm:inline">Yeni sohbet</span>
          </Link>
          <button type="button" aria-label="Sohbet geçmişini aç" onClick={() => setIsDrawerOpen(true)} className="rounded-xl border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50 lg:hidden">
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden h-[calc(100dvh-10rem)] min-h-[480px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:flex">
          {historyPanel}
        </aside>
        <section className="relative flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:h-[calc(100dvh-10rem)] lg:min-h-[480px]">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="truncate text-base font-bold text-slate-900">{history.find((item) => item.id === sessionId)?.title ?? 'Mevzuat Asistanı'}</h2>
          </div>
          <div className={`custom-scroll min-h-[400px] flex-1 overflow-y-auto ${isAssistantOpen ? 'pb-32' : ''}`}>
            {sessionId && conversation.messages.length > 0
              ? <ConversationMessages sessionId={sessionId} messages={conversation.messages} isSending={conversation.isSending} activity={conversation.activity} onRetry={(content) => void conversation.send(content)} />
              : <EmptyState />}
          </div>
          {(handoffError ?? conversation.error) && (
            <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 pb-4 sm:px-6">
              <p className="flex flex-1 items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{handoffError ?? conversation.error}
              </p>
            </div>
          )}
          <DockedAiAssistant placement="conversation" isOpen={isAssistantOpen} onOpenChange={setIsAssistantOpen} isSending={isCreating || conversation.isSending} onSend={send} />
        </section>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="mx-auto flex h-full min-h-[240px] max-w-2xl flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-lg font-bold text-slate-900">Yeni bir sohbet başlatın</h2>
      <p className="text-sm leading-relaxed text-slate-500">
        Geçmişten bir sohbet seçin veya aşağıdaki asistana yeni bir soru yazın.
      </p>
    </div>
  )
}
