import { useEffect, useState } from 'react'
import { AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { getRunReportHtml } from '../scans/api'

export function RunReportDetail() {
  const { runId, reportId } = useParams<{ runId: string; reportId: string }>()
  const [html, setHtml] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!runId || !reportId) return
    let active = true
    void getRunReportHtml(runId, reportId)
      .then((content) => { if (active) setHtml(content) })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : 'Bülten yüklenemedi') })
    return () => { active = false }
  }, [reportId, runId])

  if (error) return <section className="rounded-2xl border border-red-200 bg-white p-8 text-center"><AlertCircle className="mx-auto h-8 w-8 text-red-500" /><h1 className="mt-3 font-bold">Bülten kaydı bulunamadı</h1><p className="mt-2 text-sm text-slate-500">{error}</p></section>
  if (!html) return <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-slate-500"><RefreshCw className="h-4 w-4 animate-spin" />Bülten yükleniyor…</div>

  return <div className="space-y-4 pb-10"><Link to={`/runs/${runId}`} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600"><ArrowLeft className="h-4 w-4" />Taramaya dön</Link><iframe title="Değişiklik yok bülteni" srcDoc={html} sandbox="allow-popups allow-popups-to-escape-sandbox" className="h-[calc(100vh-150px)] min-h-[720px] w-full rounded-2xl border border-slate-200 bg-white shadow-sm" /></div>
}
