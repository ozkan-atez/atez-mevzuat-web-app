import { Link } from 'react-router-dom'
import { List, Tag, Typography } from 'antd'
const previousOutcomes: Record<string,string> = { NOT_REQUIRED:'Önceki kaynak gerekmiyor', VERIFIED:'Önceki kaynak doğrulandı', NOT_FOUND:'Önceki kaynak bulunamadı', AMBIGUOUS:'Birden fazla olası kaynak var' }
export function OperationArtifact({ kind, data }: { kind: string; data: unknown }) {
  if (!data || typeof data !== 'object') return null
  const value = data as Record<string, unknown>
  if (kind === 'FILTER_RESULT') {
    const decisions = value.decisions as {documentVersionId:string;decision:string;reason:string;evidenceExcerpt:string}[] | undefined
    return <List dataSource={decisions ?? []} renderItem={row => <List.Item><div><Tag>{({ IN:'Kapsamda', OUT:'Kapsam dışında', MAYBE:'İnceleme gerekiyor' } as Record<string,string>)[row.decision] ?? row.decision}</Tag><Typography.Paragraph>{row.reason}</Typography.Paragraph><blockquote>{row.evidenceExcerpt}</blockquote></div></List.Item>} />
  }
  if (kind === 'PREVIOUS_SOURCES') return <div>{Array.isArray(value.previousVersionIds) && value.previousVersionIds.length > 0 && <Link to="/documents">Önceki belgeleri arşivden seç</Link>}<Tag>{previousOutcomes[String(value.outcome)] ?? 'Önceki kaynak inceleme sonucu'}</Tag>{typeof value.sourceUrl === 'string' && /^https?:\/\//.test(value.sourceUrl) && <a href={value.sourceUrl} target="_blank" rel="noreferrer">Önceki düzenlemeyi aç</a>}</div>
  if (kind === 'DOCUMENT_VERSION') return <Typography.Paragraph>Belge sürümü arşive kaydedildi. <Link to="/documents">Analiz için arşivden belge seç</Link></Typography.Paragraph>
  if (kind === 'DOCUMENT_TEXT') return <Typography.Paragraph>Belgenin metin çıkarma adımı tamamlandı. Arşivde “Metni incele” ile içeriği görebilirsiniz.</Typography.Paragraph>
  if (kind === 'TARIFF_RESULT') {
    const comparisons = value.comparisons as {typeCode:string;typeName:string|null;origin:string|null;status:string;current:{value:string|null;rates:string[];regulationUrls:string[]}[];previous:{value:string|null;rates:string[]}[]|null}[] | undefined
    return <div><Typography.Title level={4}>{String(value.code ?? '')} · {String(value.date ?? '')}</Typography.Title><Typography.Paragraph>{String(value.description ?? '')}</Typography.Paragraph><Typography.Paragraph type="secondary">Destekleyici tarife kaynağı; resmî mevzuat kaynağı olarak değerlendirilmez.</Typography.Paragraph><List dataSource={comparisons ?? []} renderItem={row => <List.Item><div><Typography.Text strong>{row.typeName ?? row.typeCode}{row.origin ? ` · ${row.origin}` : ''}</Typography.Text><Tag>{({ changed:'Değişti', new:'Yeni', withdrawn:'Kaldırıldı', unchanged:'Aynı', unknown:'Karşılaştırma yok' } as Record<string,string>)[row.status] ?? row.status}</Tag><Typography.Paragraph>Güncel: {row.current.map(measure => [measure.value,...measure.rates].filter(Boolean).join(', ')).join(' / ') || 'Oran yok'}</Typography.Paragraph>{row.previous && <Typography.Paragraph>Önceki: {row.previous.map(measure => [measure.value,...measure.rates].filter(Boolean).join(', ')).join(' / ') || 'Oran yok'}</Typography.Paragraph>}{row.current.flatMap(measure => measure.regulationUrls).filter(url => /^https?:\/\//.test(url)).map((url,index) => <a key={index} href={url} target="_blank" rel="noreferrer">Dayanak mevzuat {index+1} </a>)}</div></List.Item>} />{Array.isArray(value.notes) && value.notes.map((note,index) => <Typography.Paragraph key={index}>{String(note)}</Typography.Paragraph>)}</div>
  }
  return null
}
