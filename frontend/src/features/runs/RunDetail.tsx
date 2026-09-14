import { useState } from 'react'
import { AlertCircle, ArrowLeft, CalendarDays, RefreshCw } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { retryAiFilter, retryPreviousSources } from '../scans/api'
import { retryTopicAnalysis } from '../analysis/api'
import { TopicAnalysisCard } from '../analysis/TopicAnalysisCard'
import { useScanRun } from '../scans/useScanRun'
import type { ScanRunStatus } from '../scans/types'
import { CollectedDocuments } from './CollectedDocuments'
import { OperationSteps } from './OperationSteps'

const statusLabels: Record<ScanRunStatus, string> = {
  QUEUED: 'Sırada', RUNNING: 'Çalışıyor', AWAITING_RETRY: 'Yeniden deneme bekliyor', COMPLETED: 'Tamamlandı', PARTIAL: 'Kısmen tamamlandı', FAILED: 'Başarısız', CANCELLED: 'İptal edildi',
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long', timeZone: 'Europe/Istanbul' }).format(new Date(`${value}T12:00:00+03:00`))
}

export function RunDetail() {
  const { id } = useParams<{ id: string }>()
  const { run, isLoading, notFound, error, refresh, reconnect } = useScanRun(id)
  const [isRetrying, setIsRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [retryingTopicId, setRetryingTopicId] = useState<string | null>(null)

  const handleRetry = async (kind: 'filter' | 'previous-sources') => {
    if (!id || isRetrying) return
    setIsRetrying(true)
    setRetryError(null)
    try {
      await (kind === 'filter' ? retryAiFilter(id) : retryPreviousSources(id))
      await reconnect()
    } catch (caught) {
      setRetryError(caught instanceof Error ? caught.message : 'İşlem yeniden başlatılamadı')
    } finally {
      setIsRetrying(false)
    }
  }

  const handleTopicRetry = async (topicId: string) => {
    if (retryingTopicId) return
    setRetryingTopicId(topicId)
    setRetryError(null)
    try {
      await retryTopicAnalysis(topicId)
      await reconnect()
    } catch (caught) {
      setRetryError(caught instanceof Error ? caught.message : 'Topic analizi yeniden başlatılamadı')
    } finally {
      setRetryingTopicId(null)
    }
  }

  if (isLoading) {
    return <div className="flex min-h-72 items-center justify-center text-sm text-slate-500"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Tarama yükleniyor…</div>
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <AlertCircle className="mx-auto h-9 w-9 text-slate-400" />
        <h1 className="mt-4 text-xl font-bold text-slate-900">Tarama bulunamadı</h1>
        <p className="mt-2 text-sm text-slate-500">Bu çalışma silinmiş olabilir veya bağlantı geçersizdir.</p>
        <Link to="/" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-blue-700"><ArrowLeft className="h-4 w-4" />Ana sayfaya dön</Link>
      </div>
    )
  }

  if (!run) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error || 'Tarama bilgileri alınamadı.'}
        <button type="button" onClick={() => void refresh()} className="ml-3 font-semibold underline">Tekrar dene</button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-blue-700"><ArrowLeft className="h-4 w-4" />Taramalara dön</Link>

      <div
        data-testid="run-overview"
        className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(480px,0.85fr)]"
      >
        <section className="hero-gradient relative overflow-hidden rounded-3xl border border-[#1a2e4d] p-6 text-white shadow-xl sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-indigo-500/15 blur-3xl" />
          <div className="relative flex h-full flex-wrap items-start justify-between gap-5">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-300"><CalendarDays className="h-4 w-4" />{formatDate(run.targetDate)}</div>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Tarama İnceleme Masası</h1>
              <p className="mt-2 text-sm text-slate-400">Resmî Gazete veri toplama çalışması · {run.id}</p>
            </div>
            <span className="rounded-full border border-blue-400/30 bg-blue-500/15 px-3 py-1.5 text-sm font-semibold text-blue-200">{statusLabels[run.status]}</span>
          </div>
        </section>

        <section aria-label="Operasyon özeti" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <article className="group relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-blue-300/70 hover:shadow-lg hover:shadow-blue-500/10">
            <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-blue-500/10 blur-2xl transition-transform duration-500 group-hover:scale-125" />
            <p className="relative text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Taranan madde</p>
            <p className="relative mt-2 text-4xl font-black tracking-tight text-slate-900">{run.counts.documents}</p>
            <p className="relative mt-2 text-xs font-medium leading-relaxed text-slate-500">T.C. Resmî Gazete mevzuat kaydı</p>
          </article>

          <article className="group relative overflow-hidden rounded-3xl border border-indigo-200/70 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-500/10">
            <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-gradient-to-br from-indigo-500/15 to-purple-500/5 blur-2xl transition-transform duration-500 group-hover:scale-125" />
            <p className="relative text-[11px] font-bold uppercase tracking-[0.14em] text-indigo-600">Belirlenen gümrük mevzuatı tespiti</p>
            <p className="relative mt-2 text-4xl font-black tracking-tight text-indigo-600">{run.filter?.counts.in ?? 0}</p>
            <p className="relative mt-2 text-xs font-medium leading-relaxed text-slate-500">Şirket operasyonlarını ilgilendiren değişiklik</p>
          </article>
        </section>
      </div>

      {run.errorSummary && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{run.errorSummary}</span></div>
      )}
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><span>{error}</span><button type="button" onClick={() => void refresh()} className="font-semibold underline">Yenile</button></div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <OperationSteps
          run={run}
          onRetryAiFilter={() => void handleRetry('filter')}
          onRetryPreviousSources={() => void handleRetry('previous-sources')}
          isRetrying={isRetrying}
          retryError={retryError}
        />
        <CollectedDocuments editions={run.editions} />
      </div>

      {(run.analysis?.topics.length ?? 0) > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">İlgili mevzuat analizleri</h2>
            <p className="mt-1 text-sm text-slate-500">Her belge bağımsız analiz edilir ve tek bir bülten üretir.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {run.analysis?.topics.map((topic) => (
              <TopicAnalysisCard key={topic.id} topic={topic} onRetry={(topicId) => void handleTopicRetry(topicId)} isRetrying={retryingTopicId === topic.id} />
            ))}
          </div>
        </section>
      )}

      {run.reports?.find((report) => report.card === 'K6') && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
          <h2 className="font-bold text-emerald-950">Değişiklik bulunmadı</h2>
          <p className="mt-1 text-sm text-emerald-800">Bu tarihte gümrük ve dış ticaretle ilgili bir mevzuat değişikliği tespit edilmedi.</p>
          <Link to={`/runs/${run.id}/reports/${run.reports.find((report) => report.card === 'K6')?.id}`} className="mt-4 inline-flex rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white">Değişiklik yok raporunu aç</Link>
        </section>
      )}
    </div>
  )
}
