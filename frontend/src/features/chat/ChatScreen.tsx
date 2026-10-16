import { ReportConversation } from './ReportConversation'
import { StandaloneReportCorrection } from '../reports/StandaloneReportCorrection'
import { ReportCorrectionDrawer } from '../revision/ReportCorrectionDrawer'
import { Can } from '../auth/Can'
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Alert, Button, Drawer, Empty, Select, Typography } from 'antd'
import { CloseOutlined, MenuOutlined } from '@ant-design/icons'
import { ConversationComposer } from './ConversationComposer'
import { ConversationHistory } from './ConversationHistory'
import { ConversationMessages } from './ConversationMessages'
import { createChatSession, deleteChatSession, listChatHistory, listChatReports, type ChatReportOption } from './api'
import { useConversation } from './useConversation'
import type { ChatHistoryItem, ChatSendOptions } from './types'
import './chat-workspace.css'
import { getTopic } from '../analysis/api'
import { ReportWorkspace } from '../revision/ReportWorkspace'

interface ChatLocationState extends ChatSendOptions {
  browserAgent?:boolean
  webSearch?:boolean
  initialMessage?: string
  documentVersionIds?: string[]
}

export function ChatScreen() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const topicId = searchParams.get('topic')
  const reportChatId = searchParams.get('report')
  const [standaloneReport, setStandaloneReport] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const initialSourceIds = (location.state as ChatLocationState | null)?.sourceIds
  const initialTemplateId = (location.state as ChatLocationState | null)?.templateId
  const initialBrowserAgent=(location.state as ChatLocationState | null)?.browserAgent
  const initialWebSearch = (location.state as ChatLocationState | null)?.webSearch
  const initialDocumentVersionIds = (location.state as ChatLocationState | null)?.documentVersionIds
  const initialMessage = (location.state as ChatLocationState | null)?.initialMessage?.trim() ?? ''

  const [history, setHistory] = useState<ChatHistoryItem[]>([])
  const [isHistoryLoading, setIsHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  useEffect(() => { setReportOpen(false) }, [reportChatId])
  const [selectedReport, setSelectedReport] = useState<string | null>(null)
  const [reportOptions, setReportOptions] = useState<ChatReportOption[]>([])
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)
  const [reportRunId, setReportRunId] = useState<string | null>(null)
  const [reportNotice, setReportNotice] = useState<string | null>(null)
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

  const firstUserMessageId = conversation.messages.find(message=>message.role==='USER')?.id
  useEffect(() => {
    if(!sessionId || !firstUserMessageId)return
    let cancelled=false,loading=false
    const deadline=Date.now()+25000
    const refreshTitle=async()=>{
      if(loading || cancelled)return
      loading=true
      try {
        const next=await listChatHistory()
        if(cancelled)return
        setHistory(next)
        const title=next.find(item=>item.id===sessionId)?.title
        if(Date.now()>=deadline || title && !['Yeni sohbet','Başlık hazırlanıyor…'].includes(title))clearInterval(timer)
      }catch { if(Date.now()>=deadline)clearInterval(timer) }
      finally {loading=false}
    }
    const timer=setInterval(()=>{void refreshTitle()},1500)
    void refreshTitle()
    return ()=>{cancelled=true;clearInterval(timer)}
  },[sessionId,firstUserMessageId])

  const loadReports = useCallback(async () => {
    setReportLoading(true); setReportError(null)
    try { setReportOptions(await listChatReports()) }
    catch (error) { setReportError(error instanceof Error ? error.message : 'Raporlar alınamadı.') }
    finally { setReportLoading(false) }
  }, [])
  useEffect(() => { if (reportOpen) void loadReports() }, [reportOpen, loadReports])
  // Old report URLs must never replace the conversation with a dead-end error page.
  useEffect(() => {
    if (!topicId) return
    let cancelled = false
    void getTopic(topicId).then(topic => {
      if (cancelled) return
      if (topic.reportVersion) { setSelectedReport(topicId); setReportNotice(null); setReportOpen(true) }
      else {
        setReportRunId(topic.runId ?? null)
        setReportNotice('Bu belge için henüz yayımlanmış bir bülten yok. Sohbete devam edebilir veya başka bir rapor seçebilirsiniz.')
        setSearchParams(params => { const next = new URLSearchParams(params); next.delete('topic'); next.delete('revision'); return next }, { replace: true })
      }
    }).catch(() => {
      if (!cancelled) {
        setReportRunId(null)
        setReportNotice('Seçilen rapor açılamadı. Rapor düzelt panelinden başka bir kayıt seçebilirsiniz.')
        setSearchParams(params => { const next = new URLSearchParams(params); next.delete('topic'); next.delete('revision'); return next }, { replace: true })
      }
    })
    return () => { cancelled = true }
  }, [topicId, setSearchParams])
  const closeReport = () => {
    setReportOpen(false)
    setSearchParams(params => { const next = new URLSearchParams(params); next.delete('topic'); next.delete('revision'); return next }, { replace: true })
  }

  // One conversation per handoff: React may run this effect twice (StrictMode, a
  // rerender), and a second session would strand the first message.
  const creating = useRef(false)
  useEffect(() => { if (sessionId) creating.current = false }, [sessionId])
  const startConversation = useCallback((content: string, documentVersionIds: string[] = [], options:ChatSendOptions = {}) => {
    if (creating.current || !content.trim()) return
    creating.current = true
    setHandoffError(null)
    createChatSession()
      .then((session) => navigate(`/chat/${session.id}`, { replace: true, state: { initialMessage: content.trim(), documentVersionIds,...options,...(options.webSearch?{webSearch:true}:{}),...(options.browserAgent?{browserAgent:true}:{}) }, viewTransition: true }))
      .catch((caught: unknown) => {
        creating.current = false
        setHandoffError(caught instanceof Error ? caught.message : 'Sohbet başlatılamadı.')
      })
  }, [navigate])

  useEffect(() => {
    if (sessionId || !initialMessage) return
    startConversation(initialMessage, initialDocumentVersionIds,{sourceIds: initialSourceIds, templateId: initialTemplateId, browserAgent: initialBrowserAgent, webSearch: initialWebSearch})
  }, [initialMessage, initialDocumentVersionIds, initialSourceIds, initialTemplateId, initialWebSearch, initialBrowserAgent, sessionId, startConversation])

  // The handed-over message is sent exactly once, and the router state is cleared
  // so a refresh or a back-navigation cannot resend it.
  const handedOff = useRef<string | null>(null)
  useEffect(() => {
    if (!sessionId || !initialMessage) return
    const key = `${sessionId}:${initialMessage}`
    if (handedOff.current === key) return
    let cancelled = false
    // StrictMode replays effects with an intervening cleanup. Defer until that
    // replay is over so cleanup cannot abort the one and only handoff request.
    queueMicrotask(() => {
      if (cancelled || handedOff.current === key) return
      handedOff.current = key
      navigate(`/chat/${sessionId}`, { replace: true, state: null })
      void conversation.send(initialMessage, initialDocumentVersionIds,{sourceIds: initialSourceIds, templateId: initialTemplateId, browserAgent: initialBrowserAgent, webSearch: initialWebSearch})
    })
    return () => { cancelled = true }
  }, [conversation.send, initialMessage, initialDocumentVersionIds, initialSourceIds, initialTemplateId, initialWebSearch, initialBrowserAgent, navigate, sessionId])


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
  const send = (content: string, documentVersionIds: string[] = [], options:ChatSendOptions = {}) => {
    if (sessionId) void conversation.send(content, documentVersionIds,options)
    else startConversation(content, documentVersionIds,options)
  }

  const openReportLink = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return
    const anchor = event.target.closest('a')
    if (!anchor) return
    const url = new URL(anchor.href)
    const match = /^\/reports\/([^/]+)$/.exec(url.pathname)
    if (url.origin !== window.location.origin || !match) return
    event.preventDefault()
    setSearchParams(params => {
      const next = new URLSearchParams(params)
      next.set('topic', decodeURIComponent(match[1]!))
      if (url.searchParams.has('revision')) next.set('revision', url.searchParams.get('revision')!)
      else next.delete('revision')
      return next
    }, { replace: true })
  }

  const historyPanel = (
    <ConversationHistory
      items={history}
      activeId={reportChatId ? history.find(item => item.target === `/chat?report=${encodeURIComponent(reportChatId)}`)?.id : sessionId}
      isLoading={isHistoryLoading}
      error={historyError}
      onRetry={() => void loadHistory()}
      onDelete={(id) => void handleDelete(id)}
      onOpenReports={() => { setIsDrawerOpen(false); setReportNotice(null); setReportOpen(true) }}
      onNavigate={() => setIsDrawerOpen(false)}
    />
  )

  return (
    <div className="atez-chat-workspace">
      <aside className="atez-chat-history-desktop">
        {historyPanel}
      </aside>

      <Drawer className="atez-chat-history-drawer" title="Sohbet geçmişi" placement="left" size={320} open={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} closable={false} extra={<Button aria-label="Geçmişi kapat" icon={<CloseOutlined />} type="text" onClick={() => setIsDrawerOpen(false)} />}>
        {historyPanel}
      </Drawer>

      {reportChatId ? <ReportConversation key={reportChatId} id={reportChatId} onChanged={() => void loadHistory()} onOpenHistory={() => setIsDrawerOpen(true)} onOpenReport={(key, standalone) => { setStandaloneReport(standalone ? key : null); if (!standalone) setSelectedReport(key); setReportOpen(true) }} /> : <section className="atez-chat-main">
        <header className="atez-chat-header">
          <Button aria-label="Sohbet geçmişini aç" icon={<MenuOutlined />} onClick={() => setIsDrawerOpen(true)} className="atez-chat-menu-button" />
          <div><Typography.Text strong>{history.find((item) => item.id === sessionId)?.title ?? 'Mevzuat Asistanı'}</Typography.Text><Typography.Text type="secondary" className="atez-chat-header-subtitle">Genel mevzuat soruları</Typography.Text></div>
        </header>

        {reportNotice && <Alert className="atez-chat-report-notice" type="info" showIcon title={reportNotice} action={reportRunId ? <Link to={`/runs/${encodeURIComponent(reportRunId)}`}><Button size="small">Taramayı incele</Button></Link> : undefined} closable onClose={() => setReportNotice(null)} />}
        <div className="atez-chat-scroll" onClick={openReportLink}>
          {sessionId && conversation.messages.length > 0
            ? <ConversationMessages messages={conversation.messages} isSending={conversation.isSending} activity={conversation.activity} />
            : <EmptyState />}
        </div>

        {(handoffError ?? conversation.error) && (
          <Alert className="atez-chat-error" type="warning" showIcon message={handoffError ?? conversation.error} />
        )}

        <Can permission="chat.write"><ConversationComposer isSending={conversation.isSending} onStop={conversation.stop} onSend={send} /></Can>
      </section>}
      <ReportCorrectionDrawer open={reportOpen} onClose={() => { closeReport(); void loadHistory() }} extra={<Button size="small" onClick={() => void loadReports()} loading={reportLoading}>Raporları yenile</Button>}>
        <div className="atez-report-correction-content">
          {reportError && <Alert type="warning" showIcon title={reportError} action={<Button size="small" onClick={() => void loadReports()}>Yeniden dene</Button>} />}
          <Select aria-label="Düzeltilecek rapor" placeholder="Yayımlanmış bir rapor seçin" showSearch optionFilterProp="label" loading={reportLoading} value={selectedReport ?? undefined} style={{ width: '100%' }} options={reportOptions.map(report => ({ value: report.topicId, label: `${report.title.replace(/^\s*(?:[-–—−•]\s*)+/u, '').trim()} · r${report.version} · ${report.gazetteDate}` }))} onChange={id => {
            setSelectedReport(id); setStandaloneReport(null); setReportNotice(null)
            setSearchParams(params => { const next = new URLSearchParams(params); next.set('topic', id); next.delete('revision'); return next }, { replace: true })
          }} />
          {standaloneReport ? <StandaloneReportCorrection reportId={standaloneReport} /> : selectedReport ? <ReportWorkspace key={selectedReport} topicId={selectedReport} popup onOpenConversation={() => {setReportOpen(false); navigate(`/chat?report=${encodeURIComponent(selectedReport)}`)}} onRevisionSaved={() => { void loadReports(); void loadHistory() }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Önizleme, düzeltme ve yayımlama için bir rapor seçin." />}
        </div>
      </ReportCorrectionDrawer>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="atez-chat-empty">
      <span className="atez-chat-orb" aria-hidden="true" />
      <Typography.Text className="atez-chat-eyebrow">MEVZUAT RADAR AI</Typography.Text>
      <Typography.Title level={2}>Mevzuatla ilgili bir soru sorun</Typography.Title>
      <p>
        Rapor düzenlemek için soldaki “Rapor düzelt” panelini açın. Sohbetinize buradan devam edebilirsiniz.
      </p>
    </div>
  )
}
