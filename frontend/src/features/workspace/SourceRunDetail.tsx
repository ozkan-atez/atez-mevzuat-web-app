import { PageToolbar } from '../../components/layout/PageToolbar'
import { useCan } from '../auth/AuthProvider'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Empty, Skeleton, Space, Table, Tag, Typography } from 'antd'
import { Link, useParams } from 'react-router-dom'
import { OperationTaskCard } from '../operations/OperationTaskCard'
import { ReportSourceImport } from './ManagedSourcesPanel'
import { analyzeSourceRun, countSourceDocuments, getSourceRun, hasPublishedSourceReport, retrySourceRun, sourceDocumentState, SOURCE_RUN_LABELS } from './sourceRunsApi'
import type { SourceRunDetailData, SourceRunDocument } from './sourceRunsApi'
export function SourceRunDetail() {
  const canAnalyze=useCan('analysis.run'),canRun=useCan('scan.run')
  const { id } = useParams<{ id: string }>()
  const [run, setRun] = useState<SourceRunDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const analyzeAttempt = useRef<string | null>(null)
  const [startedOperationIds, setStartedOperationIds] = useState<string[]>([])
  const [missingCount, setMissingCount] = useState(0)
  const [importing, setImporting] = useState<SourceRunDocument | null>(null)
  const load = useCallback(async () => { if (!id) return; try { setRun(await getSourceRun(id)); setError(null) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Kaynak taraması alınamadı.') } finally { setLoading(false) } }, [id])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (!run || !['QUEUED', 'RUNNING'].includes(run.status)) return; const timer = setInterval(() => void load(), 5000); return () => clearInterval(timer) }, [run?.status, load])
  const retry = async () => { if (!id) return; setBusy(true); try { await retrySourceRun(id); await load() } catch (caught) { setError(caught instanceof Error ? caught.message : 'Tarama yeniden başlatılamadı.') } finally { setBusy(false) } }
  const analyze = async () => { if (!id) return; setBusy(true); try { analyzeAttempt.current ??= crypto.randomUUID(); const result = await analyzeSourceRun(id, analyzeAttempt.current); analyzeAttempt.current = null; setStartedOperationIds(result.operationRequestIds ?? []); setMissingCount(result.missing?.length ?? 0); await load() } catch (caught) { setError(caught instanceof Error ? caught.message : 'AI değerlendirmesi başlatılamadı.') } finally { setBusy(false) } }
  if (loading) return <Skeleton active />
  const counters = run ? run.counters ?? countSourceDocuments(run.documents) : null
  return <Space orientation="vertical" size="large" style={{ width: '100%' }}>
    <PageToolbar backTo="/sources" backLabel="Kaynaklara dön"><Button onClick={() => void load()}>Yenile</Button>{canAnalyze && run?.canAnalyze && <Button type="primary" loading={busy} onClick={() => void analyze()}>AI değerlendirmesini başlat</Button>}{canRun && run && ['FAILED', 'PARTIAL'].includes(run.status) && <Button type="primary" loading={busy} onClick={() => void retry()}>Başarısız işlemleri yeniden dene</Button>}</PageToolbar>
    {error && <Alert type="error" title={error} showIcon action={<Button size="small" onClick={() => void load()}>Yeniden yükle</Button>} />}
    {run && <><Typography.Title level={3}>{run.source.name} · {run.targetDate.slice(0, 10)}</Typography.Title>
      <Space wrap><Tag color={run.status === 'FAILED' ? 'error' : run.status === 'COMPLETED' ? 'success' : 'processing'}>{SOURCE_RUN_LABELS[run.status] ?? run.status}</Tag>{run.scanRunId && <Link to={`/runs/${run.scanRunId}`}>Ana taramayı aç</Link>}</Space>
      {[...new Set([...(run.operations ?? []).map(operation => operation.id), ...startedOperationIds])].map(requestId => <OperationTaskCard key={requestId} requestId={requestId} />)}
      {missingCount > 0 && <Alert type="warning" title={`${missingCount} belgenin arşiv içeriği eksik. Hazır belgeler için bağımsız değerlendirme başlatıldı.`} showIcon />}
      {run.errorSummary && <Alert type="warning" title={run.errorSummary} description="Erişim veya AI işlemi başarısız olduysa yeniden deneyebilirsiniz. Hazır raporları aşağıdaki listeden açabilirsiniz." showIcon />}
      {counters && <div className="atez-metric-grid">{[['Bulunan belge', counters.found], ['İlgili belge', counters.relevant], ['Kapsam dışı', counters.excluded], ['Başarısız işlem', counters.failed], ['Hazır rapor', counters.readyReports]].map(([label, count]) => <Card key={String(label)} size="small"><Typography.Text type="secondary">{label}</Typography.Text><div className="atez-metric-value">{count}</div></Card>)}</div>}
      <Alert type="info" showIcon title="Belgeler AI tarafından gümrük ve dış ticaret kapsamına göre değerlendirilir." description="İlgili belgelerin doğrulanmış raporları aynı sohbet çalışma alanında açılır; düzenleme, PDF indirme ve e-posta dağıtımı buradan yapılır." />
      <Card title="Belgeler ve AI değerlendirmesi"><Table rowKey="id" dataSource={run.documents} pagination={{ pageSize: 10 }} scroll={{ x: 850 }} columns={[
        { title: 'Belge', dataIndex: 'title', width: '30%' }, { title: 'Yayın tarihi', dataIndex: 'publishedOn', width: 120, render: (value: string | null) => value?.slice(0, 10) ?? 'Belirtilmedi' },
        { title: 'Dosyalar ve ekler', key: 'files', width: 230, render: (_, document) => <Space orientation="vertical" size="small">{document.captureError && <Typography.Text type="danger">{document.captureError}</Typography.Text>}{document.capturedFiles?.map((file,index) => file.status === 'STORED' ? <a key={file.url} href={`/api/v1/source-scan-runs/${run.id}/documents/${document.id}/files/${index}`}>{file.role === 'DOCUMENT' ? 'Özgün belge' : file.title} · {file.mediaType?.split('/').at(-1)} · {Math.ceil((file.byteSize??0)/1024)} KB</a> : <Typography.Text key={file.url} type="danger">{file.title}: {file.error}</Typography.Text>)}{!document.capturedFiles?.length && <Typography.Text type="secondary">Henüz arşivlenmedi.</Typography.Text>}</Space> },
        { title: 'AI sonucu', key: 'decision', render: (_, document) => { const state = sourceDocumentState(document); return <Space orientation="vertical"><Tag color={state.color}>{state.label}</Tag>{document.filterReason && <Typography.Text type="secondary">{document.filterReason}</Typography.Text>}{document.processingError && <Typography.Text type="danger">{document.processingError}</Typography.Text>}</Space> } },
        { title: 'İşlemler', key: 'links', render: (_, document) => <Space wrap><a href={document.url} target="_blank" rel="noreferrer">Kaynağı aç</a>{hasPublishedSourceReport(document) && <Link to={`/chat?topic=${encodeURIComponent(document.topicId!)}`}><Button size="small" type="primary">Raporu aç · r{String(document.reportVersion).padStart(2, '0')}</Button></Link>}{canAnalyze && document.filterDecision === 'IN' && document.contentText && <Button size="small" onClick={() => setImporting(document)}>Başka rapora kaynak ekle</Button>}</Space> },
      ]} /></Card>
      {counters?.found === 0 && !['QUEUED', 'RUNNING'].includes(run.status) && <Empty description="Bu tarihte belge bulunmadı." />}
      {!!counters?.found && counters.readyReports === 0 && run.status === 'COMPLETED' && <Empty description={counters.excluded === counters.found ? 'Bulunan belgeler gümrük ve dış ticaret kapsamı dışında. Bu tarama için rapor üretilmedi.' : 'Henüz doğrulanmış bir rapor bulunmuyor. Belge durumlarını kontrol edin.'} />}
    </>}
    {importing && <ReportSourceImport source={{ ...importing, contentText: importing.contentText ?? null }} onClose={() => setImporting(null)} />}
  </Space>
}
