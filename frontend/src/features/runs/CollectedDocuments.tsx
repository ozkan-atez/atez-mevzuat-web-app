import { ExternalLink, FileText } from 'lucide-react'
import type { ScanRunDetail } from '../scans/types'

export function CollectedDocuments({ editions }: { editions: ScanRunDetail['editions'] }) {
  const documentCount = editions.reduce((total, edition) => total + edition.documents.length, 0)
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
        <h2 className="font-bold text-slate-900">Toplanan Belgeler</h2>
        <p className="mt-1 text-sm text-slate-500">{documentCount} belge bulundu. AI filtresinin kesin sonucu belge bazında gösterilir.</p>
      </div>
      {editions.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-slate-500">Henüz belge keşfedilmedi.</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {editions.map((edition) => (
            <div key={edition.id} className="px-5 py-5 sm:px-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-slate-800">
                  {edition.type === 'MAIN' ? 'Ana Sayı' : `${edition.supplementNo ?? ''}. Mükerrer Sayı`}
                </h3>
                <span className="text-xs text-slate-500">{edition.documents.length} belge</span>
              </div>
              <ul className="space-y-2">
                {edition.documents.map((document) => (
                  <li key={document.id} className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                    <div className="min-w-0 flex-1">
                      <a className="inline-flex items-start gap-1 text-sm font-semibold text-slate-800 hover:text-blue-700" href={document.sourceUrl} target="_blank" rel="noreferrer">
                        <span>{document.title}</span><ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      </a>
                      <p className="mt-1 text-xs text-slate-500">{document.assetCount} bağlı dosya · {document.validationStatus === 'VALID' ? 'Doğrulandı' : document.validationStatus === 'INVALID' ? 'Hatalı' : 'Bekliyor'}</p>
                      {document.filter && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${document.filter.finalDecision === 'IN' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : document.filter.finalDecision === 'OUT' ? 'border-slate-200 bg-white text-slate-600' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                            {document.filter.finalDecision === 'IN' ? 'İlgili' : document.filter.finalDecision === 'OUT' ? 'İlgisiz' : 'Değerlendiriliyor'}
                          </span>
                          <span className="text-xs text-slate-500">{document.filter.reason}</span>
                        </div>
                      )}
                      {document.previousSource && (
                        <div className="mt-2 text-xs text-slate-500">
                          {document.previousSource.outcome === 'VERIFIED' && document.previousSource.sourceUrl ? (
                            <a className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:text-blue-800" href={document.previousSource.sourceUrl} target="_blank" rel="noreferrer">
                              Önceki kaynak · {document.previousSource.publicationDate ?? document.previousSource.title}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : document.previousSource.status === 'AWAITING_RETRY' ? (
                            <span className="font-medium text-amber-700">Önceki kaynak yeniden deneme bekliyor</span>
                          ) : document.previousSource.outcome === 'NOT_FOUND' ? (
                            <span>Önceki kaynak bulunamadı</span>
                          ) : document.previousSource.outcome === 'AMBIGUOUS' ? (
                            <span>Önceki kaynak eşleşmesi belirsiz</span>
                          ) : document.previousSource.outcome === 'NOT_REQUIRED' ? (
                            <span>Önceki kaynak gerekmiyor</span>
                          ) : (
                            <span>Önceki kaynak hazırlanıyor</span>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
