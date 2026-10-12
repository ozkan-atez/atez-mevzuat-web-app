import { useCan } from '../auth/AuthProvider'
import { apiFetch } from '../../lib/apiFetch'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Input, Modal, Select, Space, Tag, Typography } from 'antd'
import { Link } from 'react-router-dom'
import { PublishStandaloneDraft } from '../reports/PublishStandaloneDraft'
import { roleOptions } from '../documents/AnalysisInputs'
import { OperationArtifact } from './OperationArtifact'
import { cancelOperation, getOperation, retryTask, startOperation, type OperationRequest } from './api'
const statusNames: Record<string, string> = { QUEUED: 'Sırada', RUNNING: 'Çalışıyor', WAITING_INPUT: 'Bilgi bekliyor', BLOCKED: 'İşlem engellendi', SUCCEEDED: 'Tamamlandı', FAILED: 'Başarısız', CANCELLED: 'İptal edildi', PARTIAL: 'Kısmen tamamlandı' }
const operationNames: Record<string, string> = { EXTRACT: 'Belgeyi oku', ANALYZE: 'Analiz', BUILD_REPORT: 'Rapor taslağı', TARIFF_LOOKUP: 'Tarife sorgusu', DISCOVER: 'Bağlantı keşfi', CAPTURE: 'Belgeyi çek', REVISE_ANALYSIS: 'Analizi düzelt', REVISE_REPORT: 'Taslağı düzenle', FILTER: 'Kapsam filtresi', PREVIOUS_SOURCES: 'Önceki kaynaklar' }
interface ArtifactContent { documentRoles?: Record<string,string>; conflicts?: {description:string;evidenceIds:string[];resolution?:string}[]; reportContent?: { title: string; summary: string; detailedAnalysis: string }; html?: string; title?: string; summary?: string; detailedAnalysis?: string; changes?: { description: string }[]; evidence?: { id: string; excerpt: string; locator?: { reference?: string; characterStart?: number; characterEnd?: number } }[] }
export function OperationTaskCard({ requestId, onUpdated }: { requestId: string; onUpdated?: (request: OperationRequest) => void }) {
  const canAnalyze=useCan('analysis.run'),canEdit=useCan('report.edit'),canManage=useCan('operation.manage')
  const updateCallback = useRef(onUpdated)
  updateCallback.current = onUpdated
  const [request, setRequest] = useState<OperationRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nextRequestId, setNextRequestId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([])
  const [templateId, setTemplateId] = useState<string | undefined>()
  const [analysisEditing, setAnalysisEditing] = useState<{taskId:string;instruction:string}|null>(null)
  const [editing, setEditing] = useState<{ taskId: string; title: string; summary: string; detailedAnalysis: string } | null>(null)
  useEffect(() => {
    let disposed = false; let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const result = await getOperation(requestId)
        if (disposed) return
        setRequest(result); setError(null); updateCallback.current?.(result)
        if (['QUEUED', 'RUNNING'].includes(result.status)) timer = setTimeout(() => void load(), 3000)
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : 'İşlem alınamadı.') }
    }
    void load(); return () => { disposed = true; clearTimeout(timer) }
  }, [requestId, refresh])
  useEffect(() => {
    if (!request?.tasks.some(task => canEdit && task.status === 'SUCCEEDED' && ['ANALYZE', 'REVISE_ANALYSIS'].includes(task.operation))) return
    let disposed = false
    void apiFetch('/api/v1/templates').then(response => response.ok ? response.json() : null).then(result => { if (!disposed && Array.isArray(result?.templates)) setTemplates(result.templates) }).catch(() => undefined)
    return () => { disposed = true }
  }, [request])
  const action = async (execute: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    try { await execute(); setRefresh(value => value + 1) } catch (e) { setError(e instanceof Error ? e.message : 'İşlem tamamlanamadı.') } finally { setBusy(false) }
  }
  return <Card size="small" title={request ? operationNames[request.operation] ?? request.operation : 'İşlem'} loading={!request && !error}>
    {error && <Alert type="error" title={error} showIcon />}
    {request && <Space orientation="vertical" style={{ width: '100%' }}>
      <Tag color={request.status === 'SUCCEEDED' ? 'success' : request.status === 'FAILED' ? 'error' : 'processing'}>{statusNames[request.status] ?? request.status}</Tag>
      {request.tasks.map(task => <div key={task.id}>
        <Typography.Text>{operationNames[task.operation] ?? task.operation}: {statusNames[task.status] ?? task.status}{task.reused ? ' · Arşivden kullanıldı' : ''}</Typography.Text>
        {task.errorMessage && <Alert type="warning" title={task.errorMessage} showIcon />}
        {canEdit && task.status === 'SUCCEEDED' && ['ANALYZE', 'REVISE_ANALYSIS'].includes(task.operation) && <Space wrap style={{ marginTop: 12 }}>
          <Select aria-label="Taslak rapor şablonu" placeholder="ATEZ varsayılan şablonu" allowClear value={templateId} onChange={setTemplateId} style={{ minWidth: 240 }} options={templates.map(template => ({ value: template.id, label: template.name }))} />
{canAnalyze && <Button size="small" onClick={() => setAnalysisEditing({taskId:task.id,instruction:''})}>Analizi düzelt</Button>}
          <Button size="small" loading={busy} onClick={() => void action(async () => { const draft = await startOperation({ operation: 'BUILD_REPORT', mode: 'FILL_MISSING', documentVersionIds: [], analysisTaskId: task.id, ...(templateId ? { templateId } : {}) }); setNextRequestId(draft.id) })}>Rapor taslağı oluştur</Button>
        </Space>}
        {task.artifacts.map((artifact, index) => {
          const data = artifact.data as ArtifactContent | undefined
          if (artifact.kind === 'ANALYSIS' && data) return <div key={index}><Typography.Title level={4}>{data.title}</Typography.Title><Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{data.summary}</Typography.Paragraph><Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{data.detailedAnalysis}</Typography.Paragraph>{data.documentRoles && <Space wrap>{roleOptions.map(role=>{const count=Object.values(data.documentRoles!).filter(value=>value===role.value).length;return count?<Tag key={role.value}>{role.label}: {count}</Tag>:null})}</Space>}{data.conflicts?.map((conflict,index)=><Alert key={index} type="warning" showIcon title={conflict.description} description={({UNRESOLVED:'Çelişki çözümlenmedi; kaynakları inceleyin.',SUPERSEDED:'Önceki düzenlemenin yerine yeni düzenleme geçti.',SCOPE_DIFFERENCE:'Belgelerin kapsamları farklı.'} as Record<string,string>)[conflict.resolution??''] ?? 'Çelişki için kaynakları inceleyin.'} />)}{data.evidence?.map(item => <blockquote key={item.id}>{item.excerpt}{item.locator?.reference && <Typography.Text type="secondary"> · {item.locator.reference}</Typography.Text>}</blockquote>)}</div>
          if (artifact.kind === 'REPORT_DRAFT' && typeof data?.html === 'string') return <div key={index}><Space><Typography.Text>Rapor taslağı</Typography.Text><PublishStandaloneDraft taskId={task.id} />{canEdit && <Button onClick={() => setEditing({ taskId: task.id, title: data.reportContent?.title ?? data.title ?? '', summary: data.reportContent?.summary ?? data.summary ?? '', detailedAnalysis: data.reportContent?.detailedAnalysis ?? data.detailedAnalysis ?? '' })}>Taslak içeriğini düzenle</Button>}</Space><iframe title={data.title ?? 'Rapor taslağı önizleme'} sandbox="" srcDoc={data.html} style={{ width: '100%', height: 600, border: '1px solid var(--atez-border)', marginTop: 12 }} /></div>
          return <OperationArtifact key={index} kind={artifact.kind} data={artifact.data} />
        })}
        {canManage && ['FAILED', 'PARTIAL', 'BLOCKED'].includes(task.status) && <Button size="small" loading={busy} onClick={() => void action(() => retryTask(task.id))}>Adımı yeniden dene</Button>}
      </div>)}
      {canManage && ['QUEUED', 'RUNNING', 'WAITING_INPUT'].includes(request.status) && <Button loading={busy} onClick={() => void action(() => cancelOperation(request.id))}>İşlemi iptal et</Button>}
      <Link to={`/operations/${request.id}`}>İşlemi incele</Link>
    </Space>}
    {nextRequestId && <OperationTaskCard requestId={nextRequestId} />}
    <Modal title="Analizi düzelt" open={!!analysisEditing} onCancel={() => setAnalysisEditing(null)} confirmLoading={busy} okText="Yeni analiz sürümü oluştur" cancelText="Vazgeç" okButtonProps={{disabled:!analysisEditing?.instruction.trim()}} onOk={() => { if (analysisEditing) void action(async () => { const result = await startOperation({operation:'REVISE_ANALYSIS',mode:'FORCE',documentVersionIds:[],analysisTaskId:analysisEditing.taskId,instruction:analysisEditing.instruction}); setNextRequestId(result.id); setAnalysisEditing(null) }) }}><Typography.Paragraph type="secondary">Düzeltme aynı belge sürümlerinden yeni bir analiz üretir. Yapay zekâ bağlantısı gerektirir.</Typography.Paragraph><Input.TextArea aria-label="Analiz düzeltme isteği" rows={5} value={analysisEditing?.instruction} onChange={event => setAnalysisEditing(current => current && {...current,instruction:event.target.value})} /></Modal>
    <Modal title="Taslak içeriğini düzenle" open={!!editing} onCancel={() => setEditing(null)} confirmLoading={busy} okText="Yeni taslak sürümünü kaydet" cancelText="Vazgeç" onOk={() => { if (editing) void action(async () => { const result = await startOperation({ operation: 'REVISE_REPORT', mode: 'FORCE', documentVersionIds: [], reportTaskId: editing.taskId, reportEdits: { title: editing.title, summary: editing.summary, detailedAnalysis: editing.detailedAnalysis } }); setNextRequestId(result.id); setEditing(null) }) }}>
      <Space orientation="vertical" style={{ width: '100%' }}><Typography.Paragraph type="secondary">ATEZ logosu ve kurumsal düzen korunur. Düzenleme yeni bir taslak oluşturur.</Typography.Paragraph><Input aria-label="Taslak başlığı" value={editing?.title} onChange={e => setEditing(current => current && { ...current, title: e.target.value })} /><Input.TextArea aria-label="Taslak özeti" rows={4} value={editing?.summary} onChange={e => setEditing(current => current && { ...current, summary: e.target.value })} /><Input.TextArea aria-label="Taslak ayrıntıları" rows={8} value={editing?.detailedAnalysis} onChange={e => setEditing(current => current && { ...current, detailedAnalysis: e.target.value })} /></Space>
    </Modal>
  </Card>
}
