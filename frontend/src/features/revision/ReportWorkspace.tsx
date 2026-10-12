import { ActionLink, BackLink } from '../../components/layout/PageToolbar'
import { useCan } from '../auth/AuthProvider'
import { Alert, Button, Card, Result, Skeleton, Space, Collapse, Tag, Tooltip, Typography } from 'antd'
import { DownloadOutlined, MailOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons'
import '../reports/reports.css'
import { useCallback, useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { getTopic } from '../analysis/api'
import { downloadReportPdf, getDeliveryContext } from '../delivery/api'
import { EmailDispatchModal } from '../delivery/EmailDispatchModal'
import type { DeliverySource } from '../delivery/types'
import type { TopicDetail } from '../analysis/types'
import { useReportDraft } from '../revision/useReportDraft'
import { ReportConversationPanel } from './ReportConversationPanel'
import { ConversationMessages } from '../chat/ConversationMessages'
import { WorkspaceCustomization } from './WorkspaceCustomization'
import { EditableReportPreview } from '../revision/EditableReportPreview'
import { ChangeList } from '../revision/ChangeList'
import { getReportDraftHistory, type SavedReportRevision } from './api'
import { PublishDraftBar } from '../revision/PublishDraftBar'

const ZOOM_STEPS = [50, 65, 80, 90, 100, 115, 130, 150] as const
const SOURCE_LABELS: Record<DeliverySource['kind'], string> = {
  GAZETTE: 'Resmî Gazete',
  PREVIOUS: 'Önceki kaynak',
  OFFICIAL: 'Resmî kaynak',
  SUPPORTING: 'Destekleyici kaynak',
}

export function ReportWorkspace({ topicId: id, popup = false, onRevisionSaved }: { topicId: string; popup?: boolean; onRevisionSaved?: () => void }) {
  const canEdit=useCan('report.edit'),canPublish=useCan('report.publish'),canSend=useCan('delivery.send')
  const [searchParams] = useSearchParams()
  const [topic, setTopic] = useState<TopicDetail | null>(null)
  const [sources, setSources] = useState<DeliverySource[]>([])
  const [isLoadingTopic, setIsLoadingTopic] = useState(true)
  const [topicError, setTopicError] = useState<string | null>(null)

  const [savedHistory,setSavedHistory] = useState<SavedReportRevision[]>([])
  const [historyLoaded,setHistoryLoaded] = useState(false)
  const [historyLoading,setHistoryLoading] = useState(false)
  const [historyError,setHistoryError] = useState<string|null>(null)
  const [zoom, setZoom] = useState(80)
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [isDispatchOpen, setIsDispatchOpen] = useState(false)

  const requestedVersion = Number(searchParams.get('revision'))
  const draft = useReportDraft(id, canEdit, Number.isInteger(requestedVersion) && requestedVersion > 0 ? requestedVersion : undefined)

  const loadTopic = useCallback(async () => {
    if (!id) return
    setTopicError(null)
    try {
      const nextTopic = await getTopic(id)
      const requestedRevision = Number(searchParams.get('revision'))
      const revision = Number.isInteger(requestedRevision) && requestedRevision > 0 ? requestedRevision : nextTopic.reportVersion
      if (!revision) throw new Error('Bu mevzuat için henüz doğrulanmış bir bülten bulunmuyor.')
      setTopic(nextTopic)
      // Sources come from the same analysis revision the bulletin was rendered from,
      // so a failure here must not hide an otherwise valid report.
      if (nextTopic.reportCard === 'K6') {
        // Empty-day bulletins have no document delivery context; use their recorded source.
        setSources([])
      } else setSources(await getDeliveryContext(id, revision).then((context) => context.sources ?? []).catch(() => []))
    } catch (caught) {
      setTopicError(caught instanceof Error ? caught.message : 'Bülten yüklenemedi')
      setTopic(null)
    } finally {
      setIsLoadingTopic(false)
    }
  }, [id, searchParams])

  useEffect(() => { void loadTopic() }, [loadTopic])


  const loadSavedHistory = useCallback(async () => { setHistoryLoading(true); setHistoryError(null); try { const result = await getReportDraftHistory(id); setSavedHistory(result.revisions ?? []); setHistoryLoaded(true) } catch (error) { setHistoryError(error instanceof Error ? error.message : 'Kaydedilmiş değişiklikler alınamadı.') } finally { setHistoryLoading(false) } }, [id])
  useEffect(() => { setSavedHistory([]); setHistoryLoaded(false); setHistoryError(null) }, [id])

  const stepZoom = (direction: -1 | 1) => {
    setZoom((current) => {
      const index = ZOOM_STEPS.indexOf(current as (typeof ZOOM_STEPS)[number])
      const nextIndex = Math.min(ZOOM_STEPS.length - 1, Math.max(0, (index === -1 ? 4 : index) + direction))
      return ZOOM_STEPS[nextIndex] ?? 100
    })
  }

  const publishedVersion = draft.view?.baseVersion ?? topic?.reportVersion ?? null

  const downloadPdf = async () => {
    if (!id || !publishedVersion || isDownloading) return
    setIsDownloading(true)
    setDownloadError(null)
    try {
      const { blob, fileName } = await downloadReportPdf(id, publishedVersion)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (caught) {
      setDownloadError(caught instanceof Error ? caught.message : 'PDF indirilemedi')
    } finally {
      setIsDownloading(false)
    }
  }

  if (isLoadingTopic || draft.isLoading) {
    return <Card className="atez-report-card"><Skeleton active paragraph={{ rows: 8 }} /></Card>
  }

  if (!topic || !draft.view || !publishedVersion) {
    if (popup) return <Alert type="warning" showIcon title="Rapor henüz hazır değil" description={topicError ?? draft.error ?? 'Bu belge için yayımlanmış bir bülten bulunmuyor.'} action={<Button onClick={() => { void loadTopic(); void draft.reload() }}>Yeniden kontrol et</Button>} />
    return <Result status="error" title="Bülten kaydı bulunamadı" subTitle={topicError ?? draft.error ?? 'Bu rapor artık mevcut olmayabilir.'} extra={<ActionLink to="/" type="primary">Ana sayfaya dön</ActionLink>} />
  }

  const reportSource = draft.view.spec.source as {label?:string;url?:string} | undefined
  const displayedSources = sources.length ? sources : reportSource?.url ? [{kind:'GAZETTE' as const,label:reportSource.label ?? 'Resmî Gazete',url:reportSource.url}] : []
  const supportsDelivery = topic.reportCard !== 'K6'
  const edits = draft.view.draft?.edits ?? []
  const pendingCount = edits.filter((edit) => !edit.revertedByEditId && !edit.revertsEditId).length

  const previewPanel = (<Card className="atez-report-card atez-report-preview-card" title="Bülten önizleme" extra={<Space wrap>
          <Space.Compact><Tooltip title="Uzaklaştır"><Button icon={<ZoomOutOutlined />} onClick={() => stepZoom(-1)} aria-label="Uzaklaştır" disabled={zoom === ZOOM_STEPS[0]} /></Tooltip><Button disabled>%{zoom}</Button><Tooltip title="Yakınlaştır"><Button icon={<ZoomInOutlined />} onClick={() => stepZoom(1)} aria-label="Yakınlaştır" disabled={zoom === ZOOM_STEPS.at(-1)} /></Tooltip></Space.Compact>
          {supportsDelivery && <Button aria-label="PDF İndir" icon={<DownloadOutlined />} onClick={() => void downloadPdf()} loading={isDownloading}>PDF İndir</Button>}
          {canSend && supportsDelivery && <Button type="primary" aria-label="E-Posta ile Dağıt" icon={<MailOutlined />} onClick={() => setIsDispatchOpen(true)}>E-Posta ile Dağıt</Button>}
        </Space>}>

          {downloadError && <Alert type="error" message={downloadError} showIcon />}
          {draft.error && <Alert type="warning" message={draft.error} showIcon />}
          {pendingCount > 0 && (
            <Alert type="info" showIcon message={`Taslak görüntüleniyor. PDF ve e-posta hâlâ yayımlanmış r${String(draft.view.publishedVersion).padStart(2, '0')} sürümünü kullanır.`} />
          )}

          <div data-testid="report-preview">
            <EditableReportPreview
              html={draft.view.html}
              zoom={zoom}
              editable={canEdit && !draft.isBusy && !draft.isPrompting && draft.conflictVersion === null && !draft.view.isStale}
              onEditField={(path, value) => void draft.editField(path, value)}
            />
          </div>
        </Card>)
  const correctionPanel = (<div className="atez-report-changes">
          {pendingCount > 0 && <Collapse items={[{ key: 'changes', label: `Bu taslaktaki değişiklikler (${pendingCount})`, children: <ChangeList edits={edits} readOnly={!canEdit} isBusy={draft.isBusy || draft.isPrompting} onRevert={(editId) => void draft.revert(editId)} /> }]} />}
      {canPublish && <PublishDraftBar
        pendingCount={pendingCount}
        isBusy={draft.isBusy}
        isPrompting={draft.isPrompting}
        conflictVersion={draft.conflictVersion}
        nextVersion={draft.view.baseVersion + 1}
        staleBehindVersion={draft.view.isStale ? draft.view.publishedVersion : null}
        onPublish={() => { void draft.publish().then(version => { if (version) { void loadTopic(); void loadSavedHistory(); onRevisionSaved?.() } }) }}
        onDiscard={() => void draft.discard()}
        onReload={() => { void draft.reload(); void loadTopic() }}
      />}

          <Collapse className="atez-report-correction-history" onChange={keys => { if (keys.includes('history') && !historyLoaded && !historyLoading) void loadSavedHistory() }} items={[{ key: 'history', label: 'Kaydedilmiş revizyonlar ve düzeltme geçmişi', children: (<Space orientation="vertical" style={{width:'100%'}}>{historyLoading && <Typography.Text type="secondary">Geçmiş yükleniyor…</Typography.Text>}{historyError && <Alert type="warning" showIcon title={historyError} action={<Button size="small" onClick={()=>void loadSavedHistory()}>Yeniden dene</Button>} />}{savedHistory.map(revision=><Card size="small" key={revision.version} title={<Space wrap><Tag>Kaydedildi · r{String(revision.version).padStart(2,'0')}</Tag><Typography.Text type="secondary">{new Date(revision.createdAt).toLocaleString('tr-TR')}</Typography.Text></Space>}>{revision.edits.length ? <ChangeList edits={revision.edits} isBusy={false} readOnly onRevert={()=>{}} /> : <Typography.Text type="secondary">Bu sürümde kayıtlı alan değişikliği yok.</Typography.Text>}</Card>)}<ConversationMessages messages={topic.thread.messages.filter((message) => message.role !== 'SYSTEM').map((message) => ({ ...message, role: message.role as 'USER' | 'ASSISTANT', status: 'COMPLETED' as const, errorDetail: null }))} isSending={draft.isPrompting} activity={draft.isPrompting ? 'Rapor düzenleniyor' : null} /></Space>) }]} />
        </div>)
  const customizationPanel = (<WorkspaceCustomization view={draft.view} isBusy={draft.isBusy || draft.isPrompting || draft.view.isStale || draft.conflictVersion !== null} onApplyTemplate={draft.applyTemplate} onSave={draft.saveCustomization} onAddSource={draft.addSource} />)

  return (
    <div className={`atez-report-page${popup ? ' atez-report-popup' : ''}`}>
      <div className="atez-report-scroll">
      <header className="atez-report-header">
        <div className="flex min-w-0 items-center gap-3">
          <BackLink to={`/runs/${topic.runId}`} compact>Taramaya dön</BackLink>
          <div className="min-w-0">
            <h1>{topic.title.replace(/^\s*(?:[-–—−•]\s*)+/u, '').trim()}</h1>
            <p className="mt-0.5 text-xs text-[var(--atez-muted)]">
              Bülten r{String(publishedVersion).padStart(2, '0')} · {topic.reportCard}
              {pendingCount > 0 && <Tag color="processing">Taslak</Tag>}
            </p>
          </div>
        </div>
      </header>

      <Card aria-label="Kullanılan kaynaklar" className="atez-report-card atez-report-sources" size="small">
        <div className="flex flex-wrap items-center gap-2">
          <Typography.Text strong>Kullanılan kaynaklar:</Typography.Text>
          {displayedSources.length === 0 && <span className="text-xs text-[var(--atez-muted)]">Kaynak listesi alınamadı.</span>}
          {displayedSources.map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noreferrer" title={source.label} className="atez-report-source"><Tag>{SOURCE_LABELS[source.kind]} <ExternalLink size={11} /></Tag></a>
          ))}
        </div>
      </Card>


      <div className="atez-report-workspace atez-report-workspace-team"><ReportConversationPanel reportId={id} onChanged={() => { void draft.reload(); void loadTopic(); void loadSavedHistory(); onRevisionSaved?.() }} />{previewPanel}</div>
      {correctionPanel}

      {canEdit && <Collapse className="atez-report-tools" items={[{ key: 'tools', label: 'Düzen ve kaynak ekleme araçları', children: customizationPanel }]} />}

      </div>


      {isDispatchOpen && (
        <EmailDispatchModal
          topicId={topic.id}
          reportVersion={publishedVersion}
          reportTitle={topic.title}
          onClose={() => setIsDispatchOpen(false)}
        />
      )}
    </div>
  )
}
