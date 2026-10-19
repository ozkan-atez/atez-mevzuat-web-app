import { useState } from 'react'
import { Card, Empty, Pagination, Tag } from 'antd'
import { ExternalLink, FileText } from 'lucide-react'
import type { ScanRunDetail } from '../scans/types'

function displayTitle(title: string) {
  return title.replace(/^\s*(?:[-–—−•]\s*)+/u, '').trim()
}
const pageSize = 8

function editionTitle(edition: ScanRunDetail['editions'][number], sourceRuns: ScanRunDetail['sourceRuns']) {
  if (edition.type !== 'EXTERNAL') {
    return `Resmî Gazete · ${edition.type === 'MAIN' ? 'Ana Sayı' : `${edition.supplementNo ?? ''}. Mükerrer Sayı`}`
  }
  const source = sourceRuns?.find(run => run.id === edition.id)?.source
  if (source) return source.name.trim() || source.key
  try {
    return new URL(edition.documents[0]?.sourceUrl ?? '').hostname.replace(/^www\./, '') || 'Kaynak belirtilmemiş'
  } catch {
    return 'Kaynak belirtilmemiş'
  }
}

export function CollectedDocuments({ editions, sourceRuns }: Pick<ScanRunDetail, 'editions' | 'sourceRuns'>) {
  const [page, setPage] = useState(1)
  const documents = editions.flatMap(edition => edition.documents.map(document => ({ document, edition })))
  const current = Math.min(page, Math.max(1, Math.ceil(documents.length / pageSize)))
  const visible = documents.slice((current - 1) * pageSize, current * pageSize)
  return <Card className="atez-run-card atez-documents-card" title="Toplanan belgeler" extra={`${documents.length} belge`}>
    <p className="atez-run-card-subtitle">Belge ve filtre sonucu. Gerekçeler için ayrıntıları açın.</p>
    {!documents.length ? <Empty description="Seçilen kapsamda işlenecek belge bulunmadı." /> : <>
      <ul className="atez-document-list">
        {visible.map(({ document, edition }, index) => {
          const title = displayTitle(document.title)
          const decision = document.filter?.finalDecision
          return <li key={document.id} className="atez-document-row">
            {(index === 0 || visible[index - 1]?.edition.id !== edition.id) && <div className="atez-document-edition">
              <h3>{editionTitle(edition, sourceRuns)}</h3>
              <span>{edition.documents.length} belge</span>
            </div>}
            <div className="atez-document-heading">
              <FileText size={15} aria-hidden="true" />
              <a href={document.sourceUrl} target="_blank" rel="noreferrer" title={title}>
                <span>{title}</span><ExternalLink size={13} aria-hidden="true" />
              </a>
              {document.filter && <Tag color={decision === 'IN' ? 'success' : decision === 'OUT' ? 'default' : 'warning'}>{decision === 'IN' ? 'İlgili' : decision === 'OUT' ? 'İlgisiz' : 'Değerlendiriliyor'}</Tag>}
            </div>
            <div className="atez-document-meta">
              <span>{document.assetCount} bağlı dosya · {document.validationStatus === 'VALID' ? 'Doğrulandı' : document.validationStatus === 'INVALID' ? 'Hatalı' : 'Bekliyor'}</span>
              {(document.filter?.reason || document.previousSource) && <details className="atez-document-details">
                <summary aria-label={`${title} — Ayrıntılar`}>Ayrıntılar</summary>
                <div className="atez-document-explanation">
                  {document.filter?.reason && <p>{document.filter.reason}</p>}
                  {document.previousSource && (document.previousSource.outcome === 'VERIFIED' && document.previousSource.sourceUrl ?
                    <a href={document.previousSource.sourceUrl} target="_blank" rel="noreferrer">Önceki kaynak · {document.previousSource.publicationDate ?? document.previousSource.title}<ExternalLink size={12} /></a> :
                    <p>{document.previousSource.status === 'AWAITING_RETRY' ? 'Önceki kaynak yeniden deneme bekliyor' : document.previousSource.outcome === 'NOT_FOUND' ? 'Önceki kaynak bulunamadı' : document.previousSource.outcome === 'AMBIGUOUS' ? 'Önceki kaynak eşleşmesi belirsiz' : document.previousSource.outcome === 'NOT_REQUIRED' ? 'Önceki kaynak gerekmiyor' : 'Önceki kaynak hazırlanıyor'}</p>)}
                </div>
              </details>}
            </div>
          </li>
        })}
      </ul>
      {documents.length > pageSize && <Pagination className="atez-document-pagination" size="small" current={current} pageSize={pageSize} total={documents.length} onChange={setPage} showSizeChanger={false} showTotal={(total, range) => `${range[0]}–${range[1]} / ${total}`} />}
    </>}
  </Card>
}
