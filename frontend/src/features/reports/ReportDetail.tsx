import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, ArrowLeft, Download, ExternalLink, LoaderCircle, Mail, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { getTopic } from '../analysis/api'
import { downloadReportPdf, getDeliveryContext } from '../delivery/api'
import { EmailDispatchModal } from '../delivery/EmailDispatchModal'
import type { DeliverySource } from '../delivery/types'
import type { TopicDetail } from '../analysis/types'
import { useReportDraft } from '../revision/useReportDraft'
import { useRegisterActiveReport } from '../revision/ActiveReportContext'
import { EditableReportPreview } from '../revision/EditableReportPreview'
import { ChangeList } from '../revision/ChangeList'
import { PublishDraftBar } from '../revision/PublishDraftBar'

const ZOOM_STEPS = [50, 65, 80, 90, 100, 115, 130, 150] as const
const SOURCE_LABELS: Record<DeliverySource['kind'], string> = {
  GAZETTE: 'Resmî Gazete',
  PREVIOUS: 'Önceki kaynak',
  OFFICIAL: 'Resmî kaynak',
  SUPPORTING: 'Destekleyici kaynak',
}

export function ReportDetail() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const [topic, setTopic] = useState<TopicDetail | null>(null)
  const [sources, setSources] = useState<DeliverySource[]>([])
  const [isLoadingTopic, setIsLoadingTopic] = useState(true)
  const [topicError, setTopicError] = useState<string | null>(null)

  const [zoom, setZoom] = useState(100)
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [isDispatchOpen, setIsDispatchOpen] = useState(false)

  const draft = useReportDraft(id)

  const loadTopic = useCallback(async () => {
    if (!id) return
    setIsLoadingTopic(true)
    setTopicError(null)
    try {
      const nextTopic = await getTopic(id)
      const requestedRevision = Number(searchParams.get('revision'))
      const revision = Number.isInteger(requestedRevision) && requestedRevision > 0 ? requestedRevision : nextTopic.reportVersion
      if (!revision) throw new Error('Bu mevzuat için henüz doğrulanmış bir bülten bulunmuyor.')
      setTopic(nextTopic)
      // Sources come from the same analysis revision the bulletin was rendered from,
      // so a failure here must not hide an otherwise valid report.
      setSources(await getDeliveryContext(id, revision).then((context) => context.sources ?? []).catch(() => []))
    } catch (caught) {
      setTopicError(caught instanceof Error ? caught.message : 'Bülten yüklenemedi')
      setTopic(null)
    } finally {
      setIsLoadingTopic(false)
    }
  }, [id, searchParams])

  useEffect(() => { void loadTopic() }, [loadTopic])

  useRegisterActiveReport(topic && id
    ? { topicId: id, title: topic.title, submitPrompt: draft.submitPrompt, isPrompting: draft.isPrompting }
    : null)

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
    return <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-slate-500"><RefreshCw className="h-4 w-4 animate-spin" />Mevzuat bülteni yükleniyor…</div>
  }

  if (!topic || !draft.view || !publishedVersion) {
    return (
      <section className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <AlertCircle className="mx-auto h-9 w-9 text-red-500" />
        <h1 className="mt-3 text-lg font-bold text-slate-900">Bülten kaydı bulunamadı</h1>
        <p className="mt-2 text-sm text-slate-500">{topicError ?? draft.error ?? 'Bu rapor artık mevcut olmayabilir.'}</p>
        <Link to="/" className="mt-5 inline-flex text-sm font-semibold text-blue-700">Ana sayfaya dön</Link>
      </section>
    )
  }

  const edits = draft.view.draft?.edits ?? []
  const pendingCount = edits.filter((edit) => !edit.revertedByEditId && !edit.revertsEditId).length

  return (
    <div className="space-y-4 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <Link to={`/runs/${topic.runId}`} aria-label="Taramaya dön" className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" /></Link>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold text-slate-900">{topic.title}</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              Bülten r{String(publishedVersion).padStart(2, '0')} · {topic.reportCard}
              {pendingCount > 0 && <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-800">taslak</span>}
            </p>
          </div>
        </div>
      </header>

      <section aria-label="Kullanılan kaynaklar" className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Kullanılan kaynaklar:</span>
          {sources.length === 0 && <span className="text-xs text-slate-400">Kaynak listesi alınamadı.</span>}
          {sources.map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noreferrer" title={source.label}
              className="inline-flex max-w-full items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-blue-400 hover:text-blue-700">
              <span className="truncate">{SOURCE_LABELS[source.kind]}</span>
              <ExternalLink className="h-3 w-3 shrink-0 text-slate-400" />
            </a>
          ))}
        </div>
      </section>

      <PublishDraftBar
        pendingCount={pendingCount}
        isBusy={draft.isBusy}
        conflictVersion={draft.conflictVersion}
        nextVersion={draft.view.baseVersion + 1}
        staleBehindVersion={draft.view.isStale ? draft.view.publishedVersion : null}
        onPublish={() => void draft.publish()}
        onDiscard={() => void draft.discard()}
        onReload={() => { void draft.reload(); void loadTopic() }}
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
            <h2 className="text-sm font-bold text-slate-900">Bülten Önizleme</h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-xl border border-slate-200 p-1">
                <button type="button" onClick={() => stepZoom(-1)} aria-label="Uzaklaştır" disabled={zoom === ZOOM_STEPS[0]} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ZoomOut className="h-4 w-4" /></button>
                <span aria-live="polite" className="min-w-12 text-center text-xs font-semibold text-slate-600">%{zoom}</span>
                <button type="button" onClick={() => stepZoom(1)} aria-label="Yakınlaştır" disabled={zoom === ZOOM_STEPS.at(-1)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40"><ZoomIn className="h-4 w-4" /></button>
              </div>
              <button type="button" onClick={() => void downloadPdf()} disabled={isDownloading} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {isDownloading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}PDF İndir
              </button>
              <button type="button" onClick={() => setIsDispatchOpen(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-100">
                <Mail className="h-4 w-4" />E-Posta ile Dağıt
              </button>
            </div>
          </div>

          {downloadError && <p className="border-b border-red-100 bg-red-50 px-5 py-2 text-xs font-medium text-red-700">{downloadError}</p>}
          {draft.error && <p className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs font-medium text-amber-800">{draft.error}</p>}
          {pendingCount > 0 && (
            <p className="border-b border-blue-100 bg-blue-50/60 px-5 py-2 text-xs font-medium text-blue-800">
              Taslak görüntüleniyor. PDF ve e-posta hâlâ yayımlanmış r{String(draft.view.publishedVersion).padStart(2, '0')} sürümünü kullanır.
            </p>
          )}

          <div data-testid="report-preview">
            <EditableReportPreview
              html={draft.view.html}
              zoom={zoom}
              editable={!draft.isBusy && draft.conflictVersion === null && !draft.view.isStale}
              onEditField={(path, value) => void draft.editField(path, value)}
            />
          </div>
        </section>

        <aside className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">Değişiklikler</h2>
            {draft.isPrompting && <LoaderCircle className="h-3.5 w-3.5 animate-spin text-indigo-500" aria-label="Talep işleniyor" />}
          </div>
          <ChangeList edits={edits} isBusy={draft.isBusy} onRevert={(editId) => void draft.revert(editId)} />
        </aside>
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
