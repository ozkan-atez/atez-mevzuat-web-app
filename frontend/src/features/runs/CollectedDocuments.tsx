import { ExternalLink, FileText } from 'lucide-react'
import type { ScanRunDetail } from '../scans/types'

export function CollectedDocuments({ editions }: { editions: ScanRunDetail['editions'] }) {
  const documentCount = editions.reduce((total, edition) => total + edition.documents.length, 0)
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
        <h2 className="font-bold text-slate-900">Toplanan Belgeler</h2>
        <p className="mt-1 text-sm text-slate-500">{documentCount} belge bulundu. Bu aşamada analiz yapılmaz.</p>
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
