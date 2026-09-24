import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Download, RefreshCw, ExternalLink } from 'lucide-react'
import { getSourceRun, retrySourceRun, type SourceRun } from './sourceRunsApi'

export function SourceRunDetail() {
  const { id = '' } = useParams()
  const [run, setRun] = useState<SourceRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    const load = () => void getSourceRun(id).then((value) => { if (active) { setRun(value); setError(null) } }).catch((caught) => { if (active) setError(String(caught)) })
    load()
    const interval = window.setInterval(load, 5000)
    return () => { active = false; window.clearInterval(interval) }
  }, [id])
  const retry = async () => { try { await retrySourceRun(id); setRun(await getSourceRun(id)) } catch (caught) { setError(String(caught)) } }
  return <div className="space-y-5 pb-16">
    <Link to="/sources" className="text-sm text-slate-500 hover:text-blue-600">← Kaynaklara dön</Link>
    <section className="rounded-2xl bg-[#132038] text-white p-7 shadow-lg">
      <p className="text-xs uppercase tracking-widest text-slate-400">Kaynak taraması</p>
      <h1 className="mt-2 text-2xl font-bold">{run?.source.name ?? 'Tarama yükleniyor'}</h1>
      <p className="mt-2 text-slate-300">{run?.targetDate?.slice(0, 10)} · {run?.status ?? '...'}</p>
      {run?.errorSummary && <p className="mt-4 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{run.errorSummary}</p>}
      <div className="mt-5 flex flex-wrap gap-3">
        {run?.hasReport && <><a className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900" href={`/api/v1/source-runs/${id}/report`} target="_blank" rel="noreferrer">Raporu aç</a><a className="inline-flex items-center gap-2 rounded-lg border border-white/30 px-4 py-2 text-sm" href={`/api/v1/source-runs/${id}/report?download=1`}><Download size={16} /> HTML indir</a></>}
        {run && ['FAILED', 'PARTIAL'].includes(run.status) && <button onClick={() => void retry()} className="inline-flex items-center gap-2 rounded-lg border border-white/30 px-4 py-2 text-sm"><RefreshCw size={16} /> Yeniden dene</button>}
      </div>
    </section>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-semibold">Bulunan kayıtlar · {run?.documents.length ?? 0}</h2>
      <div className="mt-4 divide-y divide-slate-100">{run?.documents.map((doc) => <a key={doc.id} href={doc.url} target="_blank" rel="noreferrer" className="flex items-start justify-between gap-3 py-3 text-sm hover:text-blue-600"><span>{doc.title}</span><ExternalLink size={16} className="shrink-0" /></a>)}</div>
      {run?.status === 'COMPLETED' && run.documents.length === 0 && <p className="mt-3 text-sm text-slate-500">Bu tarihte, taranabilen açık listelerde kayıt bulunmadı.</p>}
    </section>
  </div>
}
