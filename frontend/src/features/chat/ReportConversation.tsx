import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Spin, Typography } from 'antd'
import { EditOutlined, MenuOutlined } from '@ant-design/icons'
import { getReportThread, type ReportThread } from './api'
import { useCan } from '../auth/AuthProvider'
import { useReportDraft } from '../revision/useReportDraft'
import { ConversationMessages } from './ConversationMessages'
import { ConversationComposer } from './ConversationComposer'
import { ReportChatPreview } from './ReportChatPreview'

export function ReportConversation({id, onOpenReport, onOpenHistory, onChanged}: {id: string; onOpenReport: (key: string, standalone: boolean) => void; onOpenHistory: () => void; onChanged: () => void}) {
  const canEdit = useCan('report.edit')
  const [thread, setThread] = useState<ReportThread | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const draft = useReportDraft(thread?.topicId ?? undefined, canEdit)
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try { const next = await getReportThread(id, signal); if (!signal?.aborted) { setThread(next); setError(null) } }
    catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : 'Rapor sohbeti alınamadı.') }
  }, [id])
  useEffect(() => {
    const controller = new AbortController()
    let loading = false
    const load = async () => { if (loading) return; loading = true; try { await refresh(controller.signal) } finally { loading = false } }
    void load()
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void load() }, 4000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [refresh])
  const latestMessageId = thread?.messages.at(-1)?.id
  const latestVersion = thread?.latestVersion
  const reloadDraft = draft.reload
  useEffect(() => {
    if (latestMessageId || latestVersion) void reloadDraft()
  }, [latestMessageId, latestVersion, reloadDraft])
  const messages = thread?.messages ?? []
  return <section className="atez-chat-main">
    <header className="atez-chat-header">
      <Button aria-label="Sohbet geçmişini aç" icon={<MenuOutlined />} onClick={onOpenHistory} className="atez-chat-menu-button" />
      <div><Typography.Text strong>{thread?.title ?? 'Rapor sohbeti'}</Typography.Text><Typography.Text type="secondary" className="atez-chat-header-subtitle">Ortak rapor geçmişi{thread ? ` · r${thread.latestVersion}` : ''}</Typography.Text></div>
      {thread && <Button icon={<EditOutlined />} onClick={() => onOpenReport(thread.topicId ?? thread.reportId, !thread.topicId)}>Raporu aç</Button>}
    </header>
    {error && <Alert type="warning" title={error} action={<Button onClick={() => void refresh()}>Yeniden dene</Button>} />}
    {thread && <ReportChatPreview thread={thread} view={draft.view} loading={draft.isLoading} />}
    <div className="atez-chat-scroll">
      {!thread && !error && <Spin />}
      <ConversationMessages messages={pending && !messages.some(item => item.content === pending && item.role === 'USER') ? [...messages, {id:'pending-report-prompt',role:'USER',content:pending,status:'COMPLETED',errorDetail:null,createdAt:new Date().toISOString()}] : messages} isSending={draft.isPrompting} activity={draft.isPrompting ? 'Rapor düzenleniyor' : null} />
    </div>
    {draft.error && <Alert type="warning" title={draft.error} />}
    {canEdit && thread?.topicId && <ConversationComposer attachmentsEnabled={false} placeholder="Bu raporu nasıl değiştirelim?" isSending={draft.isLoading || draft.isPrompting || draft.isBusy} onSend={content => {
      setPending(content)
      void draft.submitPrompt(content).finally(() => { setPending(null); void refresh(); onChanged() })
    }} />}
  </section>
}
