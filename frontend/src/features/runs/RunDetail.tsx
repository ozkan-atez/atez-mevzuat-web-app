import { useState } from 'react'
import { AlertCircle, ArrowLeft, CalendarDays, RefreshCw } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { retryScanRun, retryAiFilter, retryPreviousSources } from '../scans/api'
import { retryTopicAnalysis } from '../analysis/api'
import { useScanRun } from '../scans/useScanRun'
import type { ScanRunStatus } from '../scans/types'
import { CollectedDocuments } from './CollectedDocuments'
import { OperationSteps } from './OperationSteps'
import { GeneratedReports } from './GeneratedReports'
import { classifyRunError } from './classifyRunError'

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

  const handleFullRetry = async () => {
    if (!run || isRetrying) return
    setIsRetrying(true)
    setRetryError(null)
    try {
      await retryScanRun(run.id)
      await reconnect()
    } catch (caught) {
      setRetryError(caught instanceof Error ? caught.message : 'Tarama yeniden başlatılamadı')
    } finally {
      setIsRetrying(false)
    }
  }

  if (isLoading || (run && run.id !== id)) {
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
        className="space-y-6"
      >
        <section className="hero-gradient relative overflow-hidden rounded-3xl border border-[#1a2e4d] p-6 text-white shadow-xl sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-indigo-500/15 blur-3xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-5">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-300"><CalendarDays className="h-4 w-4" />{formatDate(run.targetDate)}</div>
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Tarama İnceleme Masası</h1>
              <p className="mt-2 text-sm text-slate-400">{(run.sourceKeys ?? ['resmi-gazete']).map((key) => key === 'resmi-gazete' ? 'Resmî Gazete' : run.sourceResults?.find((source) => source.sourceKey === key)?.sourceName ?? key).join(' · ')} kaynak taraması</p>
            </div>
            <span className="rounded-full border border-blue-400/30 bg-blue-500/15 px-3 py-1.5 text-sm font-semibold text-blue-200">{statusLabels[run.status]}</span>
          </div>
          {(run.status === 'FAILED' || run.status === 'PARTIAL' || run.filter?.retryAvailable || run.previousSources?.retryAvailable || (run.analysis?.counts.awaitingRetry ?? 0) > 0) && (
            <div className="relative mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="min-w-0 flex-1">
                {run.errorSummary && <div role="alert" className="text-xs text-rose-200">
                  <p className="font-semibold">{classifyRunError(run).title}</p>
                  <p className="mt-1 leading-relaxed">{classifyRunError(run).detail}</p>
                </div>}
                {(run.status === 'FAILED' || run.status === 'PARTIAL') && <p className="mt-1 text-[11px] text-slate-400">Tamamlanan aşamalar korunarak bu tarama kaldığı yerden devam eder.</p>}
                {(run.analysis?.counts.awaitingRetry ?? 0) > 0 && <p className="mt-1 text-[11px] text-amber-200">Bekleyen analizleri yeniden denemek için Analiz durum noktasını açın.</p>}
              </div>
              {(run.status === 'FAILED' || run.status === 'PARTIAL') && (
                <button type="button" onClick={() => void handleFullRetry()} disabled={isRetrying} className="inline-flex items-center gap-2 rounded-lg border border-blue-400/30 bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60">
                  <RefreshCw className={`h-3.5 w-3.5 ${isRetrying ? 'animate-spin' : ''}`} />{isRetrying ? 'Başlatılıyor…' : 'Kaldığı yerden devam et'}
                </button>
              )}
              {run.filter?.retryAvailable && (
                <button type="button" onClick={() => void handleRetry('filter')} disabled={isRetrying} className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-400/20 disabled:cursor-wait disabled:opacity-60">
                  {isRetrying ? 'Başlatılıyor…' : 'AI filtresini tekrar dene'}
                </button>
              )}
              {run.previousSources?.retryAvailable && (
                <button type="button" onClick={() => void handleRetry('previous-sources')} disabled={isRetrying} className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-400/20 disabled:cursor-wait disabled:opacity-60">
                  {isRetrying ? 'Başlatılıyor…' : 'Önceki kaynakları tekrar dene'}
                </button>
              )}
            </div>
          )}
          {retryError && <p role="alert" className="relative mt-2 text-xs text-rose-200">{retryError}</p>}
          <OperationSteps
            run={run}
            onRetryTopic={(topicId) => void handleTopicRetry(topicId)}
            retryingTopicId={retryingTopicId}
          />
        </section>

        <section aria-label="Operasyon özeti" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <article className="group relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-blue-300/70 hover:shadow-lg hover:shadow-blue-500/10">
            <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-blue-500/10 blur-2xl transition-transform duration-500 group-hover:scale-125" />
            <p className="relative text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Taranan madde</p>
            <p className="relative mt-2 text-4xl font-black tracking-tight text-slate-900">{run.counts.documents + (run.sourceResults ?? []).reduce((total, source) => total + source.documentCount, 0)}</p>
            <p className="relative mt-2 text-xs font-medium leading-relaxed text-slate-500">Seçilen kaynaklardan toplanan kayıt</p>
          </article>

          <article className="group relative overflow-hidden rounded-3xl border border-indigo-200/70 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-500/10">
            <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-gradient-to-br from-indigo-500/15 to-purple-500/5 blur-2xl transition-transform duration-500 group-hover:scale-125" />
            <p className="relative text-[11px] font-bold uppercase tracking-[0.14em] text-indigo-600">{run.sourceKeys?.includes('resmi-gazete') ?? true ? 'Belirlenen gümrük mevzuatı tespiti' : 'Kaynaklardan bulunan kayıt'}</p>
            <p className="relative mt-2 text-4xl font-black tracking-tight text-indigo-600">{run.sourceKeys?.includes('resmi-gazete') ?? true ? run.filter?.counts.in ?? 0 : (run.sourceResults ?? []).reduce((total, source) => total + source.documentCount, 0)}</p>
            <p className="relative mt-2 text-xs font-medium leading-relaxed text-slate-500">{run.sourceKeys?.includes('resmi-gazete') ?? true ? 'Şirket operasyonlarını ilgilendiren değişiklik' : 'Kaynaklarda yayımlanan belge ve duyuru'}</p>
          </article>
        </section>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><span>{error}</span><button type="button" onClick={() => void refresh()} className="font-semibold underline">Yenile</button></div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <CollectedDocuments editions={run.editions} sourceResults={run.sourceResults} />
        <GeneratedReports runId={run.id} reports={run.reports ?? []} sourceResults={run.sourceResults} duplicateGroups={run.reportDuplicateGroups} />
      </div>

    </div>
  )
}
