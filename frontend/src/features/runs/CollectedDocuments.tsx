import { useState } from 'react'
import { ChevronDown, ExternalLink, FileText } from 'lucide-react'
import type { ScanRunDetail } from '../scans/types'

type Document = ScanRunDetail['editions'][number]['documents'][number]
type Filter = 'all' | 'relevant' | 'other'

function relevance(document: Document) {
  if (document.filter?.finalDecision === 'IN') return { label: 'İlgili', color: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
  if (document.filter?.finalDecision === 'OUT') return { label: 'İlgisiz', color: 'border-slate-200 bg-slate-100 text-slate-600' }
  return { label: 'Bekliyor', color: 'border-amber-200 bg-amber-50 text-amber-700' }
}

function PreviousSource({ document }: { document: Document }) {
  const source = document.previousSource
  if (!source) return null
  return <div className="text-xs text-slate-600">
    <span className="font-semibold text-slate-700">Önceki kaynak: </span>
    {source.outcome === 'VERIFIED' && source.sourceUrl ? (
      <a className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline" href={source.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Önceki kaynak · ${source.publicationDate ?? source.title ?? ''}`}>
        {source.publicationDate ?? source.title}<ExternalLink className="h-3 w-3" />
      </a>
    ) : source.status === 'AWAITING_RETRY' ? <span className="text-amber-700">Yeniden deneme bekliyor</span>
      : source.outcome === 'NOT_FOUND' ? 'Bulunamadı'
        : source.outcome === 'AMBIGUOUS' ? 'Eşleşme belirsiz'
          : source.outcome === 'NOT_REQUIRED' ? 'Gerekmiyor'
            : 'Hazırlanıyor'}
  </div>
}

export function CollectedDocuments({ editions, sourceResults = [] }: { editions: ScanRunDetail['editions']; sourceResults?: NonNullable<ScanRunDetail['sourceResults']> }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const documents = editions.flatMap((edition) => edition.documents)
  const sourceDocumentCount = sourceResults.reduce((count, source) => count + source.documents.length, 0)
  const relevantCount = documents.filter((document) => document.filter?.finalDecision === 'IN').length
  const otherCount = documents.length - relevantCount
  const visible = (document: Document) => filter === 'all' || (filter === 'relevant' ? document.filter?.finalDecision === 'IN' : document.filter?.finalDecision !== 'IN')

  return <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Toplanan Belgeler">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div>
        <h2 className="font-bold text-slate-900">Toplanan Belgeler</h2>
        <p className="mt-0.5 text-xs text-slate-500">{documents.length + sourceDocumentCount} belge · Ayrıntılar için belgeyi açın</p>
      </div>
      <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1" role="group" aria-label="Belgeleri filtrele">
        {([
          ['all', 'Tümü', documents.length + sourceDocumentCount],
          ['relevant', 'İlgili', relevantCount],
          ['other', 'Diğer', otherCount + sourceDocumentCount],
        ] as const).map(([value, label, count]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setOpenId(null) }}
          className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${filter === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{label} <span className="tabular-nums opacity-65">{count}</span></button>)}
      </div>
    </div>

    {editions.length === 0 && sourceDocumentCount === 0 ? <div className="px-5 py-10 text-center text-sm text-slate-500">Henüz belge keşfedilmedi.</div> :
      <div className="max-h-[420px] overflow-y-auto overscroll-contain" data-testid="collected-document-list">
        {editions.map((edition) => {
          const shown = edition.documents.filter(visible)
          if (!shown.length) return null
          return <div key={edition.id}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-y border-slate-100 bg-slate-50/95 px-5 py-2 text-xs backdrop-blur-sm">
              <h3 className="font-bold text-slate-700">{edition.type === 'MAIN' ? 'Ana Sayı' : `${edition.supplementNo ?? ''}. Mükerrer Sayı`}</h3>
              <span className="text-slate-500">{shown.length} belge</span>
            </div>
            <ul className="divide-y divide-slate-100">{shown.map((document) => {
              const isOpen = openId === document.id
              const status = relevance(document)
              return <li key={document.id} className="min-w-0">
                <div className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-slate-50/80 sm:px-5">
                  <FileText className="mt-1 h-4 w-4 shrink-0 text-blue-600" aria-hidden="true" />
                  <button type="button" aria-expanded={isOpen} aria-controls={`document-details-${document.id}`} onClick={() => setOpenId(isOpen ? null : document.id)}
                    className="min-w-0 flex-1 text-left focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                    <span className="line-clamp-2 text-[13px] font-semibold leading-5 text-slate-800">{document.title}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">{document.assetCount} ek · {document.validationStatus === 'VALID' ? 'Doğrulandı' : document.validationStatus === 'INVALID' ? 'Hatalı' : 'Bekliyor'}</span>
                  </button>
                  <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${status.color}`}>{status.label}</span>
                  <a href={document.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`${document.title} kaynağını aç`} title="Resmî kaynağı aç" className="mt-0.5 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-blue-700"><ExternalLink className="h-3.5 w-3.5" /></a>
                  <button type="button" onClick={() => setOpenId(isOpen ? null : document.id)} aria-label={`${document.title} ayrıntılarını ${isOpen ? 'kapat' : 'aç'}`} aria-expanded={isOpen} aria-controls={`document-details-${document.id}`}
                    className="mt-0.5 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"><ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} /></button>
                </div>
                {isOpen && <div id={`document-details-${document.id}`} className="space-y-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3 pl-11 text-xs leading-5 text-slate-600">
                  {document.filter?.reason && <p><span className="font-semibold text-slate-700">Filtre gerekçesi: </span>{document.filter.reason}</p>}
                  <PreviousSource document={document} />
                </div>}
              </li>
            })}</ul>
          </div>
        })}
        {filter !== 'relevant' && sourceResults.filter((source) => source.documents.length > 0).map((source) => <div key={source.id}>
          <div className="sticky top-0 z-10 flex items-center justify-between border-y border-slate-100 bg-slate-50/95 px-5 py-2 text-xs backdrop-blur-sm"><h3 className="font-bold text-slate-700">{source.sourceName}</h3><span className="text-slate-500">{source.documents.length} belge</span></div>
          <ul className="divide-y divide-slate-100">{source.documents.map((document) => <li key={document.id} className="flex items-start gap-2.5 px-4 py-2.5 sm:px-5"><FileText className="mt-1 h-4 w-4 shrink-0 text-blue-600" /><div className="min-w-0 flex-1"><p className="line-clamp-2 text-[13px] font-semibold leading-5 text-slate-800">{document.title}</p><p className="mt-0.5 text-[11px] text-slate-500">{document.publishedOn ?? 'Tarih belirtilmedi'} · Kaynak kaydı</p></div><a href={document.url} target="_blank" rel="noopener noreferrer" aria-label={`${document.title} kaynağını aç`} className="mt-0.5 rounded-md p-1 text-slate-500 hover:text-blue-700"><ExternalLink className="h-3.5 w-3.5" /></a></li>)}</ul>
        </div>)}
        {filter !== 'all' && !editions.some((edition) => edition.documents.some(visible)) && <p className="px-5 py-8 text-center text-sm text-slate-500">Bu filtrede belge yok.</p>}
      </div>}
  </section>
}
