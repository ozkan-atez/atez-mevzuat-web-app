import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listScanRuns } from '../scans/api'
import type { ScanRunStatus, ScanRunSummary } from '../scans/types'

const statusLabels: Record<ScanRunStatus, string> = {
  QUEUED: 'Sırada', RUNNING: 'Çalışıyor', AWAITING_RETRY: 'Yeniden deneme bekliyor', COMPLETED: 'Tamamlandı', PARTIAL: 'Kısmen tamamlandı', FAILED: 'Başarısız', CANCELLED: 'İptal edildi',
}

const statusClasses: Record<ScanRunStatus, string> = {
  QUEUED: 'border-slate-200 bg-slate-50 text-slate-700',
  RUNNING: 'border-blue-200 bg-blue-50 text-blue-700',
  AWAITING_RETRY: 'border-amber-200 bg-amber-50 text-amber-700',
  COMPLETED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  PARTIAL: 'border-amber-200 bg-amber-50 text-amber-700',
  FAILED: 'border-red-200 bg-red-50 text-red-700',
  CANCELLED: 'border-slate-200 bg-slate-50 text-slate-600',
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeZone: 'Europe/Istanbul' }).format(new Date(`${value}T12:00:00+03:00`))
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }).format(new Date(value))
}

export function RecentScanRuns() {
  const [runs, setRuns] = useState<ScanRunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void listScanRuns(10)
      .then(setRuns)
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Taramalar alınamadı'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm" data-purpose="recent-scan-runs">
      <div className="border-b border-slate-200/80 p-5 sm:px-6">
        <h2 className="text-lg font-bold text-slate-900 sm:text-xl">Son Oluşturulan Taramalar</h2>
        <p className="text-xs text-slate-500 sm:text-sm">PostgreSQL’de kayıtlı gerçek manuel ve zamanlanmış tarama çalışmaları</p>
      </div>
      <div className="overflow-x-auto custom-scroll">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="border-b border-slate-200/80 bg-slate-50/80 text-xs font-semibold uppercase text-slate-500">
            <tr><th className="px-6 py-3.5">Tarih</th><th className="px-6 py-3.5">Çalışma</th><th className="px-6 py-3.5">Kaynak / Tür</th><th className="px-6 py-3.5">Durum</th><th className="px-6 py-3.5 text-right">Aksiyon</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">Taramalar yükleniyor…</td></tr>}
            {!loading && error && <tr><td colSpan={5} className="px-6 py-8 text-center text-red-600">{error}</td></tr>}
            {!loading && !error && runs.length === 0 && <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">Henüz tarama oluşturulmadı.</td></tr>}
            {runs.map((run) => (
              <tr key={run.id} className="transition hover:bg-slate-50/60">
                <td className="whitespace-nowrap px-6 py-4 font-medium text-slate-900"><div>{formatDate(run.targetDate)}</div><div className="mt-0.5 text-xs text-slate-400">{formatTime(run.createdAt)}</div></td>
                <td className="px-6 py-4"><div className="font-mono text-xs font-semibold text-slate-800">{run.id.slice(0, 8)}</div><div className="mt-1 text-xs text-slate-500">{run.counts.documents} belge · {run.counts.assets} bağlı dosya · {run.counts.editions} sayı</div></td>
                <td className="whitespace-nowrap px-6 py-4"><span className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">Resmî Gazete · {run.trigger === 'MANUAL' ? 'Manuel' : 'Cron'}</span></td>
                <td className="whitespace-nowrap px-6 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusClasses[run.status]}`}>{statusLabels[run.status]}</span></td>
                <td className="whitespace-nowrap px-6 py-4 text-right"><Link to={`/runs/${run.id}`} className="inline-flex rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:text-blue-600">İncele</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
