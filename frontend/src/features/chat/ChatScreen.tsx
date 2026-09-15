import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Menu, Sparkles, X } from 'lucide-react'
import { ConversationComposer } from './ConversationComposer'
import { ConversationHistory } from './ConversationHistory'
import { ConversationMessages } from './ConversationMessages'
import { createChatSession, deleteChatSession, listChatHistory } from './api'
import { useConversation } from './useConversation'
import type { ChatHistoryItem } from './types'

interface ChatLocationState {
  initialMessage?: string
}

export function ChatScreen() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const initialMessage = (location.state as ChatLocationState | null)?.initialMessage?.trim() ?? ''

  const [history, setHistory] = useState<ChatHistoryItem[]>([])
  const [isHistoryLoading, setIsHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [handoffError, setHandoffError] = useState<string | null>(null)

  const conversation = useConversation(sessionId)

  const loadHistory = useCallback(async () => {
    setIsHistoryLoading(true)
    setHistoryError(null)
    try {
      setHistory(await listChatHistory())
    } catch (caught: unknown) {
      setHistoryError(caught instanceof Error ? caught.message : 'Sohbet geçmişi alınamadı.')
    } finally {
      setIsHistoryLoading(false)
    }
  }, [])

  useEffect(() => { void loadHistory() }, [loadHistory])

  // One conversation per handoff: React may run this effect twice (StrictMode, a
  // rerender), and a second session would strand the first message.
  const creating = useRef(false)
  const startConversation = useCallback((content: string) => {
    if (creating.current || !content.trim()) return
    creating.current = true
    setHandoffError(null)
    createChatSession()
      .then((session) => navigate(`/chat/${session.id}`, { replace: true, state: { initialMessage: content.trim() }, viewTransition: true }))
      .catch((caught: unknown) => {
        creating.current = false
        setHandoffError(caught instanceof Error ? caught.message : 'Sohbet başlatılamadı.')
      })
  }, [navigate])

  useEffect(() => {
    if (sessionId || !initialMessage) return
    startConversation(initialMessage)
  }, [initialMessage, sessionId, startConversation])

  // The handed-over message is sent exactly once, and the router state is cleared
  // so a refresh or a back-navigation cannot resend it.
  const handedOff = useRef(false)
  useEffect(() => {
    if (!sessionId || handedOff.current || !initialMessage) return
    handedOff.current = true
    navigate(`/chat/${sessionId}`, { replace: true, state: null })
    void conversation.send(initialMessage)
  }, [conversation, initialMessage, navigate, sessionId])

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

  // The list shows the title and the newest line, both of which just changed.
  const wasSending = useRef(false)
  useEffect(() => {
    if (wasSending.current && !conversation.isSending) void loadHistory()
    wasSending.current = conversation.isSending
  }, [conversation.isSending, loadHistory])

  // On the empty state there is no conversation yet, so the first message opens
  // one and is sent through the same handoff the dashboard uses.
  const send = (content: string) => {
    if (sessionId) void conversation.send(content)
    else startConversation(content)
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
    <div className="flex h-[calc(100vh-1px)] w-full bg-slate-50">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-slate-800 bg-[#0d1424] lg:flex xl:w-80">
        <div className="border-b border-slate-800 px-4 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-xs font-medium text-slate-400 transition hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" />Panoya dön
          </Link>
        </div>
        {historyPanel}
      </aside>

      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <button type="button" aria-label="Geçmişi kapat" onClick={() => setIsDrawerOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
          <div className="relative flex h-full w-72 flex-col bg-[#0d1424] shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <Link to="/" className="inline-flex items-center gap-2 text-xs font-medium text-slate-400">
                <ArrowLeft className="h-3.5 w-3.5" />Panoya dön
              </Link>
              <button type="button" aria-label="Geçmişi kapat" onClick={() => setIsDrawerOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            {historyPanel}
          </div>
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
          <button
            type="button"
            aria-label="Sohbet geçmişini aç"
            onClick={() => setIsDrawerOpen(true)}
            className="rounded-xl border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50 lg:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>
          <h1 className="truncate text-sm font-bold text-slate-900">
            {history.find((item) => item.id === sessionId)?.title ?? 'Mevzuat Asistanı'}
          </h1>
        </header>

        <div className="custom-scroll flex-1 overflow-y-auto">
          {sessionId && conversation.messages.length > 0
            ? <ConversationMessages messages={conversation.messages} isSending={conversation.isSending} activity={conversation.activity} />
            : <EmptyState />}
        </div>

        {(handoffError ?? conversation.error) && (
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 pb-2 sm:px-6">
            <p className="flex flex-1 items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{handoffError ?? conversation.error}
            </p>
          </div>
        )}

        <ConversationComposer isSending={conversation.isSending} onSend={send} />
      </section>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
        <Sparkles className="h-5 w-5" />
      </span>
      <h2 className="text-xl font-bold text-slate-900">Bugün ne öğrenmek istersiniz?</h2>
      <p className="text-sm leading-relaxed text-slate-500">
        Gümrük ve dış ticaret mevzuatıyla ilgili sorularınızı yazın. Sohbetleriniz soldaki geçmişte saklanır ve istediğiniz zaman kaldığınız yerden devam edebilirsiniz.
      </p>
    </div>
  )
}
