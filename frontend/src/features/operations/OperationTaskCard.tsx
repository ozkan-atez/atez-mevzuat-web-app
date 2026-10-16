import { useCan } from '../auth/AuthProvider'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Space, Tag, Typography } from 'antd'
import { Link } from 'react-router-dom'
import { PublishStandaloneDraft } from '../reports/PublishStandaloneDraft'
import { OperationArtifact } from './OperationArtifact'
import { cancelOperation, getOperation, retryTask, type OperationRequest } from './api'
const statusNames: Record<string, string> = { QUEUED: 'Sırada', RUNNING: 'Çalışıyor', WAITING_INPUT: 'Bilgi bekliyor', BLOCKED: 'İşlem engellendi', SUCCEEDED: 'Tamamlandı', FAILED: 'Başarısız', CANCELLED: 'İptal edildi', PARTIAL: 'Kısmen tamamlandı' }
const operationNames: Record<string, string> = { EXTRACT: 'Belgeyi oku', ANALYZE: 'Analiz', BUILD_REPORT: 'Rapor oluşturma', PUBLISH_REPORT:'Raporlar’a kaydetme', TARIFF_LOOKUP: 'Tarife sorgusu', DISCOVER: 'Bağlantı keşfi', CAPTURE: 'Belgeyi çek', REVISE_ANALYSIS: 'Analiz revizyonu', REVISE_REPORT: 'Rapor revizyonu', FILTER: 'Kapsam filtresi', PREVIOUS_SOURCES: 'Önceki kaynaklar' }
interface ArtifactContent { html?: string; title?: string; summary?: string; detailedAnalysis?: string; reportId?:string; url?:string; evidence?:{id:string;excerpt:string}[] }
export function OperationTaskCard({ requestId, onUpdated }: { requestId: string; onUpdated?: (request: OperationRequest) => void }) {
  const canManage=useCan('operation.manage')
  const updateCallback = useRef(onUpdated)
  updateCallback.current = onUpdated
  const [request, setRequest] = useState<OperationRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let disposed = false; let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const result = await getOperation(requestId)
        if (disposed) return
        setRequest(result); setError(null); updateCallback.current?.(result)
        if (['QUEUED', 'RUNNING'].includes(result.status)) timer = setTimeout(() => void load(), 2000)
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : 'İşlem alınamadı.') }
    }
    void load(); return () => { disposed = true; clearTimeout(timer) }
  }, [requestId, refresh])
  const action = async (execute: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    try { await execute(); setRefresh(value => value + 1) } catch (e) { setError(e instanceof Error ? e.message : 'İşlem tamamlanamadı.') } finally { setBusy(false) }
  }
  const publicationTasks=request?.tasks.filter(t=>t.operation==='PUBLISH_REPORT')??[]
  const saved=publicationTasks.filter(t=>t.status==='SUCCEEDED').length
  return <Card size="small" title={request ? operationNames[request.operation] ?? request.operation : 'İşlem'} loading={!request && !error}>
    {error && <Alert type="error" title={error} showIcon />}
    {request && <Space orientation="vertical" style={{ width: '100%' }}>
      <Tag color={request.status === 'SUCCEEDED' ? 'success' : request.status === 'FAILED' ? 'error' : 'processing'}>{statusNames[request.status] ?? request.status}</Tag>
      {!!publicationTasks.length && <Typography.Text>{saved} / {publicationTasks.length} rapor Raporlar’a kaydedildi.</Typography.Text>}
      {request.tasks.map(task => <div key={task.id}>
        {task.operation==='ANALYZE' && task.parameters?.executionSnapshot?.group && <Typography.Title level={5}>{task.parameters.executionSnapshot.group.index}. {task.parameters.executionSnapshot.group.title}</Typography.Title>}
        <Typography.Text>{operationNames[task.operation] ?? task.operation}: {statusNames[task.status] ?? task.status}{task.reused ? ' · Arşivden kullanıldı' : ''}</Typography.Text>
        {task.errorMessage && <Alert type="warning" title={task.errorMessage} showIcon />}
        {task.artifacts.map((artifact, index) => {
          const data = artifact.data as ArtifactContent | undefined
          if(artifact.kind==='PUBLISHED_REPORT' && data?.reportId)return <div key={index}><Link to={`/reports/documents/${data.reportId}`}>{data.title??'Raporu aç'}</Link><Typography.Paragraph type="secondary">Raporu açarak sohbetten düzenleyebilir veya analizini inceleyebilirsiniz.</Typography.Paragraph></div>
          if (artifact.kind === 'ANALYSIS' && data) return <details key={index}><summary>Analiz sonucunu göster</summary><Typography.Title level={4}>{data.title}</Typography.Title><Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{data.summary}</Typography.Paragraph><Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{data.detailedAnalysis}</Typography.Paragraph>{data.evidence?.map(item => <blockquote key={item.id}>{item.excerpt}</blockquote>)}</details>
          if (artifact.kind === 'REPORT_DRAFT' && typeof data?.html === 'string') return <div key={index}>{!publicationTasks.length && <PublishStandaloneDraft taskId={task.id} />}<details><summary>{data.title??'Rapor önizlemesi'}</summary><iframe title={data.title ?? 'Rapor taslağı önizleme'} sandbox="" srcDoc={data.html} style={{ width: '100%', height: 600, border: '1px solid var(--atez-border)', marginTop: 12 }} /></details></div>
          return <OperationArtifact key={index} kind={artifact.kind} data={artifact.data} />
        })}
        {canManage && ['FAILED', 'PARTIAL', 'BLOCKED'].includes(task.status) && <Button size="small" loading={busy} onClick={() => void action(() => retryTask(task.id))}>Adımı yeniden dene</Button>}
      </div>)}
      {canManage && ['QUEUED', 'RUNNING', 'WAITING_INPUT'].includes(request.status) && <Button loading={busy} onClick={() => void action(() => cancelOperation(request.id))}>İşlemi iptal et</Button>}
      <Link to={`/operations/${request.id}`}>İşlemi incele</Link>
    </Space>}
  </Card>
}
