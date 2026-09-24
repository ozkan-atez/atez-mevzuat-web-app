import { ArrowUpRight, FileText } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ScanRunDetail } from '../scans/types'

export function GeneratedReports({ runId, reports, sourceResults = [], duplicateGroups = [] }: { runId: string; reports: NonNullable<ScanRunDetail['reports']>; sourceResults?: NonNullable<ScanRunDetail['sourceResults']>; duplicateGroups?: NonNullable<ScanRunDetail['reportDuplicateGroups']> }) {
  const sourceReports = sourceResults.filter((source) => source.hasReport)
  const duplicateFor = (id: string) => duplicateGroups.find((group) => group.reportIds.includes(id))
  return (
    <section aria-labelledby="generated-reports-heading" className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
        <h2 id="generated-reports-heading" className="font-bold text-slate-900">Oluşturulan Raporlar</h2>
        <p className="mt-1 text-sm text-slate-500">{reports.length + sourceReports.length} rapor oluşturuldu. Hazır bültenleri buradan açabilirsiniz.</p>
      </div>
      {reports.length + sourceReports.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <FileText aria-hidden="true" className="mx-auto mb-3 h-7 w-7 text-slate-300" />
          <p className="text-sm font-medium text-slate-600">Henüz rapor oluşturulmadı.</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">Hazırlanan raporlar bu alanda listelenecek.</p>
        </div>
      ) : (
        <ul className="space-y-2 px-5 py-5 sm:px-6">
          {reports.map((report) => (
            <li key={report.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
              <div className="flex items-start gap-3">
                <FileText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
                <div className="min-w-0 flex-1">
                  <h3 className="break-words text-sm font-semibold text-slate-800">{report.title}</h3>
                  <p className="mt-1 text-xs text-slate-500">Sürüm {report.version}</p>
                  {duplicateFor(`report:${report.id}`) && <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800"><p className="font-semibold">Aynı düzenleme başka bir raporda da yer alıyor</p><p className="mt-0.5 leading-relaxed">{duplicateFor(`report:${report.id}`)!.reason}</p></div>}
                  {report.card === 'K6' && (
                    <div className="mt-2 text-xs leading-relaxed text-emerald-700">
                      <p className="font-semibold">Değişiklik bulunmadı</p>
                      <p>Bu tarihte gümrük ve dış ticaretle ilgili bir mevzuat değişikliği tespit edilmedi.</p>
                    </div>
                  )}
                  <Link
                    to={report.topicId ? `/reports/${report.topicId}?revision=${report.version}` : `/runs/${runId}/reports/${report.id}`}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 focus-visible:outline-2 focus-visible:outline-indigo-500"
                  >
                    {report.card === 'K6' ? 'Değişiklik yok raporunu aç' : 'Raporu aç'}
                    <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </li>
          ))}
          {sourceReports.map((source) => <li key={source.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
            <div className="flex items-start gap-3"><FileText aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" /><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-slate-800">{source.sourceName} kaynak raporu</h3><p className="mt-1 text-xs text-slate-500">{source.documentCount} kayıt</p>{duplicateFor(`source:${source.id}`) && <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800"><p className="font-semibold">Mükerrer kaynak</p><p className="mt-0.5 leading-relaxed">{duplicateFor(`source:${source.id}`)!.reason}</p></div>}
              <div className="mt-3 flex flex-wrap gap-2"><a href={`/api/v1/source-runs/${source.id}/report`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100">Raporu aç <ArrowUpRight className="h-3.5 w-3.5" /></a><a href={`/api/v1/source-runs/${source.id}/report?download=1`} className="inline-flex items-center rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">HTML indir</a></div>
            </div></div>
          </li>)}
        </ul>
      )}
    </section>
  )
}
