import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { getTopic, getTopicReportHtml } from '../analysis/api'
import { TopicAnalysisChat } from '../analysis/TopicAnalysisChat'
import type { TopicDetail } from '../analysis/types'

export function ReportDetail() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const [topic, setTopic] = useState<TopicDetail | null>(null)
  const [html, setHtml] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setIsLoading(true)
    setError(null)
    try {
      const nextTopic = await getTopic(id)
      const requestedRevision = Number(searchParams.get('revision'))
      const revision = Number.isInteger(requestedRevision) && requestedRevision > 0
        ? requestedRevision
        : nextTopic.reportVersion
      if (!revision) throw new Error('Bu mevzuat için henüz doğrulanmış bir bülten bulunmuyor.')
      const nextHtml = await getTopicReportHtml(id, revision)
      setTopic(nextTopic)
      setHtml(nextHtml)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Bülten yüklenemedi')
      setTopic(null)
      setHtml('')
    } finally {
      setIsLoading(false)
    }
  }, [id, searchParams])

  useEffect(() => { void load() }, [load])

  if (isLoading) return <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-slate-500"><RefreshCw className="h-4 w-4 animate-spin" />Mevzuat bülteni yükleniyor…</div>

  if (!topic || !html) {
    return (
      <section className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
        <AlertCircle className="mx-auto h-9 w-9 text-red-500" />
        <h1 className="mt-3 text-lg font-bold text-slate-900">Bülten kaydı bulunamadı</h1>
        <p className="mt-2 text-sm text-slate-500">{error ?? 'Bu rapor artık mevcut olmayabilir.'}</p>
        <Link to="/" className="mt-5 inline-flex text-sm font-semibold text-blue-700">Ana sayfaya dön</Link>
      </section>
    )
  }

  return (
    <div className="space-y-4 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <Link to={`/runs/${topic.runId}`} aria-label="Taramaya dön" className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" /></Link>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold text-slate-900">{topic.title}</h1>
            <p className="mt-0.5 text-xs text-slate-500">Bülten r{String(topic.reportVersion ?? 1).padStart(2, '0')} · {topic.reportCard}</p>
          </div>
        </div>
        <a href={topic.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700">Resmî Gazete kaynağı <ExternalLink className="h-3.5 w-3.5" /></a>
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section data-testid="report-preview" className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm">
          <iframe title="Bülten Önizleme" srcDoc={html} sandbox="allow-popups allow-popups-to-escape-sandbox" className="h-[calc(100vh-190px)] min-h-[680px] w-full bg-white" />
        </section>
        <TopicAnalysisChat topicId={topic.id} onQueued={() => window.setTimeout(() => void load(), 1200)} />
      </div>
    </div>
  )
}
