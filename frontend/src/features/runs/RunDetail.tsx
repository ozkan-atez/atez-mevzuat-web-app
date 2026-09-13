import { AlertCircle, ArrowLeft, CalendarDays, Database, FileText, Image, RefreshCw } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { useScanRun } from '../scans/useScanRun'
import type { ScanRunStatus } from '../scans/types'
import { CollectedDocuments } from './CollectedDocuments'
import { OperationSteps } from './OperationSteps'

const statusLabels: Record<ScanRunStatus, string> = {
  QUEUED: 'Sırada', RUNNING: 'Çalışıyor', COMPLETED: 'Tamamlandı', PARTIAL: 'Kısmen tamamlandı', FAILED: 'Başarısız', CANCELLED: 'İptal edildi',
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long', timeZone: 'Europe/Istanbul' }).format(new Date(`${value}T12:00:00+03:00`))
}

export function RunDetail() {
  const { id } = useParams<{ id: string }>()
  const { run, isLoading, notFound, error, refresh } = useScanRun(id)

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

      <section className="rounded-3xl border border-slate-800 bg-slate-950 p-6 text-white shadow-xl sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-300"><CalendarDays className="h-4 w-4" />{formatDate(run.targetDate)}</div>
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Resmî Gazete Veri Toplama</h1>
            <p className="mt-2 text-sm text-slate-400">Çalışma: {run.id}</p>
          </div>
          <span className="rounded-full border border-blue-400/30 bg-blue-500/15 px-3 py-1.5 text-sm font-semibold text-blue-200">{statusLabels[run.status]}</span>
        </div>
      </section>

      {run.errorSummary && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{run.errorSummary}</span></div>
      )}
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><span>{error}</span><button type="button" onClick={() => void refresh()} className="font-semibold underline">Yenile</button></div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: 'Sayı', value: run.counts.editions, icon: Database },
          { label: 'Belge', value: run.counts.documents, icon: FileText },
          { label: 'Bağlı dosya', value: run.counts.assets, icon: Image },
        ].map((item) => <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><item.icon className="h-5 w-5 text-blue-600" /><div className="mt-3 text-2xl font-extrabold text-slate-900">{item.value}</div><div className="text-sm text-slate-500">{item.label}</div></div>)}
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <OperationSteps run={run} />
        <CollectedDocuments editions={run.editions} />
      </div>
    </div>
  )
}
