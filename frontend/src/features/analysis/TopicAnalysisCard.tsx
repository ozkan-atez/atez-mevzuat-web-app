import { AlertCircle, CheckCircle2, FileText, LoaderCircle, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { TopicSummary } from './types'

const labels: Record<TopicSummary['status'], string> = {
  QUEUED: 'Sırada', ANALYZING: 'Analiz ediliyor', ANALYZED: 'Analiz tamamlandı', RENDERING: 'Rapor hazırlanıyor', VALIDATING: 'Rapor doğrulanıyor',
  COMPLETED: 'Tamamlandı', AWAITING_RETRY: 'Yeniden deneme bekliyor', BLOCKED: 'İnceleme gerekli', FAILED: 'Başarısız',
}

export function TopicAnalysisCard({ topic, onRetry, isRetrying = false }: { topic: TopicSummary; onRetry: (topicId: string) => void; isRetrying?: boolean }) {
  const active = ['ANALYZING', 'RENDERING', 'VALIDATING'].includes(topic.status)
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">Topic analizi</p>
          <h3 className="mt-1 text-sm font-bold leading-6 text-slate-900">{topic.title}</h3>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {active ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : topic.status === 'COMPLETED' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <AlertCircle className="h-3.5 w-3.5" />}
          {labels[topic.status]}
        </span>
      </div>
      {topic.errorMessage && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-medium text-amber-800">{topic.errorMessage}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {topic.reportVersion && <Link to={`/reports/${topic.id}?revision=${topic.reportVersion}`} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"><FileText className="h-3.5 w-3.5" />Raporu aç</Link>}
        {topic.retryAvailable && <button type="button" onClick={() => onRetry(topic.id)} disabled={isRetrying} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${isRetrying ? 'animate-spin' : ''}`} />Analizi tekrar dene</button>}
        {topic.analysisVersion && <span className="text-xs text-slate-500">Analiz r{String(topic.analysisVersion).padStart(2, '0')}</span>}
      </div>
    </article>
  )
}
