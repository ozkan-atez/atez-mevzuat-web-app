import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { discardRunReportDraft, getRunReportReview, previewRunReportPrompt, saveRunReportDraft, saveRunReportReview, type RunReportReview } from '../scans/api'
import { ReportPreviewPanel } from '../revision/ReportPreviewPanel'
import { clearLocalReportEdits, readLocalReportEdits } from '../revision/EditableReportPreview'
import { PublishDraftBar } from '../revision/PublishDraftBar'
import { ChangeList } from '../revision/ChangeList'
import type { ReportFieldEditRecord } from '../revision/types'
import { useRegisterActiveReport } from '../revision/ActiveReportContext'

const ZOOM_STEPS = [50, 65, 80, 90, 100, 115, 130, 150] as const

export function RunReportDetail() {
  const { runId, reportId } = useParams<{ runId: string; reportId: string }>()
  const [report, setReport] = useState<RunReportReview | null>(null)
  const [pending, setPending] = useState<Record<string, string>>({})
  const [previewKey, setPreviewKey] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [isSaving, setIsSaving] = useState(false)
  const [isDraftSaving, setIsDraftSaving] = useState(false)
  const [isPrompting, setIsPrompting] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const editQueue = useRef<Promise<void>>(Promise.resolve())
  const draftStorageKey = `report-edits:run:${runId}:${reportId}`

  useEffect(() => {
    if (!runId || !reportId) return
    let active = true
    setReport(null)
    setPending({})
    setPreviewHtml(null)
    setError(null)
    void getRunReportReview(runId, reportId)
      .then((next) => {
        if (!active) return
        const local = readLocalReportEdits(draftStorageKey).emptyDayText
        const hasLocalEdit = local !== undefined && local !== next.spec.emptyDayText
        setReport(hasLocalEdit ? { ...next, reviewStatus: 'PENDING_APPROVAL' } : next)
        setPending(hasLocalEdit ? { emptyDayText: local } : next.draft ? { emptyDayText: next.draft.spec.emptyDayText } : {})
        setPreviewHtml(next.draft?.html ?? null)
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Bülten yüklenemedi') })
    return () => { active = false }
  }, [reportId, runId])

  const stepZoom = (direction: -1 | 1) => {
    setZoom((current) => {
      const index = ZOOM_STEPS.indexOf(current as typeof ZOOM_STEPS[number])
      return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + direction))] ?? 100
    })
  }

  const submitPrompt = useCallback(async (message: string) => {
    if (!runId || !reportId || !report || isPrompting || isSaving || isDraftSaving) return
    setIsPrompting(true)
    setError(null)
    try {
      const result = await previewRunReportPrompt(runId, reportId, {
        expectedVersion: report.version,
        message,
      })
      setReport((current) => current ? { ...current, reviewStatus: 'PENDING_APPROVAL' } : current)
      setPending((current) => ({ ...current, ...Object.fromEntries(result.edits.map((edit) => [edit.path, edit.value])) }))
      setPreviewHtml(result.html)
      setPreviewKey((current) => current + 1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Revizyon isteği işlenemedi')
    } finally {
      setIsPrompting(false)
    }
  }, [isPrompting, isSaving, isDraftSaving, report, reportId, runId])

  useRegisterActiveReport(report && reportId
    ? { topicId: reportId, title: report.title, submitPrompt, isPrompting }
    : null)

  const save = async () => {
    if (!runId || !reportId || !report || isSaving || isPrompting || isDraftSaving) return
    const edits = Object.entries(pending).map(([path, value]) => ({ path, value }))
    if (edits.length === 0) return
    setIsSaving(true)
    setError(null)
    try {
      const next = await saveRunReportReview(runId, reportId, report.version, edits)
      setReport(next)
      clearLocalReportEdits(draftStorageKey)
      setPending({})
      setPreviewHtml(null)
      setPreviewKey((current) => current + 1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Rapor kaydedilemedi')
    } finally {
      setIsSaving(false)
    }
  }

  const editField = (path: string, value: string): Promise<void> => {
    if (!runId || !reportId || !report) return Promise.reject(new Error('Rapor yüklenemedi'))
    const operation = editQueue.current.then(async () => {
      setIsDraftSaving(true)
      setError(null)
      try {
        if (value === report.spec.emptyDayText) {
          await discardRunReportDraft(runId, reportId)
          setPending({})
          setPreviewHtml(null)
          setReport((current) => current ? { ...current, reviewStatus: 'READY', draft: null } : current)
        } else {
          const next = await saveRunReportDraft(runId, reportId, report.version, value)
          setPending({ [path]: next.draft.spec.emptyDayText })
          setPreviewHtml(next.draft.html)
          setReport((current) => current ? { ...current, reviewStatus: 'PENDING_APPROVAL' } : current)
        }
        setPreviewKey((current) => current + 1)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Revizyon taslağı kaydedilemedi')
        throw caught
      } finally {
        setIsDraftSaving(false)
      }
    })
    editQueue.current = operation.catch(() => undefined)
    return operation
  }

  const discard = async () => {
    if (!runId || !reportId || isDraftSaving || isPrompting) return
    setIsDraftSaving(true)
    setError(null)
    try {
      await discardRunReportDraft(runId, reportId)
      clearLocalReportEdits(draftStorageKey)
      setPending({})
      setPreviewHtml(null)
      setReport((current) => current ? { ...current, reviewStatus: 'READY', draft: null } : current)
      setPreviewKey((current) => current + 1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Revizyon iptal edilemedi')
    } finally {
      setIsDraftSaving(false)
    }
  }

  if (!report && error) return <section className="rounded-2xl border border-red-200 bg-white p-8 text-center"><AlertCircle className="mx-auto h-8 w-8 text-red-500" /><h1 className="mt-3 font-bold">Bülten kaydı bulunamadı</h1><p className="mt-2 text-sm text-slate-500">{error}</p></section>
  if (!report) return <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-slate-500"><RefreshCw className="h-4 w-4 animate-spin" />Bülten yükleniyor…</div>

  const edits: ReportFieldEditRecord[] = Object.entries(pending).map(([path, value], index) => ({
    id: path, sequence: index + 1, path, previousValue: report.spec.emptyDayText,
    nextValue: value, source: 'USER', prompt: null, chatMessageId: null,
    revertible: true, revertsEditId: null, revertedByEditId: null, createdAt: '',
  }))

  return (
    <div className="space-y-4 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <Link to={`/runs/${runId}`} aria-label="Taramaya dön" className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" /></Link>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold text-slate-900">{report.title}</h1>
            <p className="mt-0.5 text-xs text-slate-500">Bülten r{String(report.version).padStart(2, '0')} · K6{edits.length > 0 && <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-800">taslak</span>}</p>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${report.reviewStatus === 'PENDING_APPROVAL' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800'}`}>
          {report.reviewStatus === 'PENDING_APPROVAL' ? 'Gönderilemez · Revizyon onayı bekleniyor' : 'Gönderime hazır'}
        </span>
      </header>

      <section aria-label="Kullanılan kaynaklar" className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <span className="mr-3 text-xs font-bold uppercase tracking-wide text-slate-500">Kullanılan kaynaklar:</span>
        <a href={report.spec.source.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-blue-700 hover:underline">{report.spec.source.label}</a>
      </section>

      <PublishDraftBar
        pendingCount={edits.length}
        isBusy={isSaving || isPrompting || isDraftSaving}
        conflictVersion={null}
        nextVersion={report.version + 1}
        staleBehindVersion={null}
        onPublish={() => void save()}
        onDiscard={() => void discard()}
        onReload={() => undefined}
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <ReportPreviewPanel
          key={previewKey}
          previewKey={previewKey}
          html={previewHtml ?? report.html}
          zoom={zoom}
          editable={!isSaving && !isPrompting}
          draftStorageKey={draftStorageKey}
          onZoomOut={() => stepZoom(-1)}
          onZoomIn={() => stepZoom(1)}
          zoomOutDisabled={zoom === ZOOM_STEPS[0]}
          zoomInDisabled={zoom === ZOOM_STEPS.at(-1)}
          error={error}
          onEditField={editField}
        />
      <aside className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900">Değişiklikler</h2>
        <ChangeList
          edits={edits}
          isBusy={isSaving || isPrompting || isDraftSaving}
          emptyMessage="Henüz değişiklik yok. Bülten üzerindeki bilgi metnine tıklayarak düzenleyebilirsiniz."
          onRevert={() => void discard()}
        />
      </aside>
      </div>
    </div>
  )
}
