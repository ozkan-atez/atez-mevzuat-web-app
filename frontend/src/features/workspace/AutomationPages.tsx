import { BackgroundMonitor } from './BackgroundMonitor'
import { PageToolbar } from '../../components/layout/PageToolbar'
import { Can } from '../auth/Can'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Col, Empty, Form, Input, Modal, Popconfirm, Row, Select, Space, Switch, Table, Tag, Typography, message } from 'antd'
import { DeleteOutlined, EditOutlined, PlayCircleOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { listCustomerGroups } from '../delivery/api'
import { listAutomations, listSources, listTemplates, workspaceRequest } from './api'
import type { AutomationRun, WorkspaceAutomation } from './api'
import { useResource } from './useResource'
import { AutomationStagePanel } from './AutomationStagePanel'
import type { OperationRequest } from '../operations/api'
import { LoadError, PageHeading } from './CatalogPages'
import './workspace.css'
import './automations.css'
const { Text } = Typography

const dayOptions = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'].map((label, index) => ({ label, value: index + 1 }))
function scheduleLabel(item: WorkspaceAutomation) {
  const times = item.times?.length ? item.times : [`${String(item.hour).padStart(2, '0')}:${String(item.minute).padStart(2, '0')}`]
  const days = item.weekdays?.length ? item.weekdays : [1,2,3,4,5,6,7]
  return `${days.length === 7 ? 'Her gün' : days.map(day => dayOptions[day - 1]?.label).join(', ')} · ${times.join(', ')} · ${item.timezone}`
}

function AutomationEditor({ item, open, onClose, onSaved }: { item: WorkspaceAutomation | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const sources = useResource(listSources, { sources: [] })
  const templates = useResource(listTemplates, { templates: [], components: [] })
  const groups = useResource(listCustomerGroups, [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form] = Form.useForm()
  const values = item ? { ...item, times: item.times?.length ? item.times : [`${String(item.hour).padStart(2, '0')}:${String(item.minute).padStart(2, '0')}`], weekdays: item.weekdays?.length ? item.weekdays : [1,2,3,4,5,6,7] } : { name: '', datePolicy: 'PUBLISHED_DATE', times: ['04:00'], weekdays: [1,2,3,4,5,6,7], timezone: 'Europe/Istanbul', sourceIds: [], groupIds: [], templateId: null, isActive: true }
  const save = async (input: Record<string, unknown>) => {
    setSaving(true); setError(null)
    try { await workspaceRequest(item ? `automations/${item.id}` : 'automations', { method: item ? 'PATCH' : 'POST', body: JSON.stringify({ ...input, templateId: input.templateId ?? null }) }); onSaved(); onClose() }
    catch (caught) { setError((caught as Error).message) } finally { setSaving(false) }
  }
  return <Modal title={item ? 'Otomasyonu düzenle' : 'Otomasyon oluştur'} open={open} onCancel={onClose} onOk={() => form.submit()} okText="Kaydet" cancelText="Vazgeç" confirmLoading={saving} destroyOnHidden afterOpenChange={visible => { if (visible) form.setFieldsValue(values) }}><LoadError error={sources.error || templates.error || groups.error} retry={() => { void sources.refresh(); void templates.refresh(); void groups.refresh() }} />{error && <Alert type="error" title={error} style={{ marginBottom: 12 }} />}<Form form={form} layout="vertical" onFinish={save} initialValues={values}><Form.Item name="name" label="Otomasyon adı" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="sourceIds" label="Taranacak kaynaklar" rules={[{ required: true, type: 'array', min: 1, message: 'En az bir kaynak seçin.' }]}><Select mode="multiple" options={sources.data.sources.filter(source => source.isActive).map(source => ({ value: source.id, label: `${source.name}${source.scanSupported ? '' : ' · otomatik tarama desteklenmiyor'}`, disabled: !source.scanSupported }))} /></Form.Item><Form.Item name="datePolicy" label="İçerik seçimi" extra="Resmî Gazete seçilen günün sayıları üzerinden taranır; bu seçim diğer kaynaklara uygulanır."><Select options={[{value:"PUBLISHED_DATE",label:"Seçilen gün yayımlananlar"},{value:"NEW_OR_CHANGED",label:"Yeni veya değişen içerikler (tarihsizler dahil)"}]} /></Form.Item><Form.Item name="times" label="Tekrar saatleri" rules={[{ required: true, type: 'array', min: 1, max: 24, message: 'En az bir saat girin (SS:DD).' }, { validator: async (_, times: string[]) => { if (times?.some(time => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new Error('Saatleri 08:30 gibi SS:DD biçiminde girin.') } }]}><Select mode="tags" tokenSeparators={[',']} placeholder="08:00, 12:30, 18:00" options={['04:00','08:00','12:00','18:00','23:00'].map(value => ({ value, label: value }))} /></Form.Item><Form.Item name="weekdays" label="Tekrar günleri" rules={[{ required: true, type: 'array', min: 1, message: 'En az bir gün seçin.' }]}><Select mode="multiple" options={dayOptions} /></Form.Item><Form.Item name="isActive" label="Etkin" valuePropName="checked"><Switch /></Form.Item><Form.Item name="timezone" label="Saat dilimi"><Select options={[{ value: 'Europe/Istanbul', label: 'İstanbul (UTC+3)' }]} /></Form.Item><Form.Item name="templateId" label="Rapor şablonu"><Select allowClear options={templates.data.templates.filter(template => template.isActive).map(template => ({ value: template.id, label: template.name }))} /></Form.Item><Form.Item name="groupIds" label="Önerilen alıcı grupları"><Select mode="multiple" options={groups.data.filter(group => group.isActive).map(group => ({ value: group.id, label: group.name }))} /></Form.Item><Text type="secondary">Raporlar incelemeye açılır. E-posta gönderimi rapor çalışma alanından onaylanır.</Text></Form></Modal>
}

export function AutomationsPage() {
  const resource = useResource(listAutomations, { automations: [] })
  const sources = useResource(listSources, { sources: [] })
  useEffect(() => { const timer = setInterval(() => void resource.refresh(), 10000); return () => clearInterval(timer) }, [resource.refresh])
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  return <div className="atez-demo-page atez-automations-page">
    <PageHeading title="Otomasyonlar" description="Kaynak ve çalışma saatlerini yönetin. Raporlar ve işlem kayıtları için Geçmiş ve yönetim’i açın." action={<Space wrap><Button icon={<ReloadOutlined />} onClick={() => void resource.refresh()}>Yenile</Button><Can permission="config.manage"><Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Otomasyon oluştur</Button></Can></Space>} />
    <LoadError error={resource.error} retry={() => void resource.refresh()} />
    <Card className="atez-automation-card" title="Tüm otomasyonlar" extra={<Text type="secondary">{resource.data.automations.length} otomasyon</Text>}>
      {!resource.loading && !resource.data.automations.length ? <div className="atez-automation-empty"><p>Henüz otomasyon yok. Kaynak ve saat seçerek ilk işinizi oluşturun.</p><Can permission="config.manage"><Button size="small" onClick={() => setOpen(true)}>İlk otomasyonu ekle</Button></Can></div> : <Table className="atez-automation-list" size="middle" rowKey="id" loading={resource.loading} dataSource={resource.data.automations} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 650 }} columns={[
        { title: 'Otomasyon', dataIndex: 'name', render: (name: string, item) => <Link className="atez-automation-name" to={`/automations/${item.id}`}>{name}</Link> }, { title: 'Kaynak ve sıklık', render: (_, item) => <div className="atez-history-cell"><span>{item.sourceIds.map(id => sources.data.sources.find(source => source.id === id)?.name ?? 'Kaynak').join(', ')}</span><span className="atez-automation-recurrence">{scheduleLabel(item)}</span></div> },
        { title: 'Durum', dataIndex: 'isActive', render: value => <Tag color={value ? 'success' : 'default'}>{value ? 'Etkin' : 'Duraklatıldı'}</Tag> },
        { title: 'Son çalışma', dataIndex: 'lastRunAt', render: value => value ? new Date(value).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : 'Henüz çalışmadı' },
        { title: '', render: (_, item) => <Button size="small" onClick={() => navigate(`/automations/${item.id}`)}>Geçmiş ve yönetim</Button> },
      ]} expandable={{ rowExpandable: item => Boolean(item.lastError), expandedRowRender: item => <Alert type="error" showIcon title={item.lastError} /> }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Henüz otomasyon yok. Kaynak ve saat seçerek ilk işinizi oluşturun." /> }} />}
    </Card>
    <Can permission="admin.manage"><BackgroundMonitor /></Can>
    <AutomationEditor open={open} item={null} onClose={() => setOpen(false)} onSaved={() => void resource.refresh()} />
  </div>

}

const runStatuses: Record<string, string> = { QUEUED: 'Sırada', RUNNING: 'Çalışıyor', AWAITING_RETRY: 'Tekrar bekliyor', COMPLETED: 'Tamamlandı', PARTIAL: 'Kısmen tamamlandı', FAILED: 'Başarısız', CANCELLED: 'İptal edildi' }
const formatTime = (value: string | null) => value ? new Date(value).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : '—'
function RunHistory({ runs, automations, loading, pagination }: { runs: AutomationRun[]; automations: WorkspaceAutomation[]; loading?: boolean; pagination?: { current: number; pageSize: number; total: number; onChange: (page: number) => void; showSizeChanger: boolean } }) {
  return <Table rowKey="id" size="small" dataSource={runs} loading={loading} scroll={{ x: 900 }} pagination={pagination ?? { pageSize: 10, showSizeChanger: false }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Henüz çalışma kaydı yok. Otomasyonlar çalıştıkça raporları ve işlem kayıtları burada görünür." /> }} columns={[
    { title: 'Otomasyon / çalışma', render: (_, run) => {
      const item = automations.find(item => item.id === run.automationId)
      const name = run.workspaceConfig?.automationName || item?.name || (run.scheduleSlot ? 'Eski sabit zamanlama' : 'Kaldırılmış otomasyon')
      return <div className="atez-history-cell">{item ? <Link to={`/automations/${item.id}`}>{name}</Link> : <strong>{name}</strong>}<Text type="secondary">{run.trigger === 'MANUAL' ? 'Elle başlatıldı' : 'Zamanlanmış'} · {run.id.slice(0, 8)}</Text></div>
    } },
    { title: 'Çalışma zamanı', render: (_, run) => <div className="atez-history-cell"><span>{formatTime(run.createdAt)}</span><Text type="secondary">İçerik tarihi: {run.targetDate.slice(0, 10)}</Text></div> },
    { title: 'Durum', render: (_, run) => <Tag color={run.status === 'COMPLETED' ? 'success' : run.status === 'FAILED' ? 'error' : run.status === 'PARTIAL' ? 'warning' : 'processing'}>{runStatuses[run.status] ?? run.status}</Tag> },
    { title: 'Üretilen raporlar', render: (_, run) => <div className="atez-history-cell">{run.topicReports?.length ? run.topicReports.map(report => <Link key={report.id} to={report.topicId ? `/reports/${report.topicId}` : `/runs/${run.id}/reports/${report.id}`}>{report.title} · v{report.latestVersion}</Link>) : <Text type="secondary">Henüz rapor üretilmedi</Text>}</div> },
    { title: 'İşlem kayıtları', render: (_, run) => <div className="atez-history-cell"><Link to={`/runs/${run.id}`}>Logları ve ayrıntıları aç</Link>{run.errorSummary && <Text type="danger">{run.errorSummary}</Text>}</div> },
  ]} expandable={{ expandedRowRender: run => <div className="atez-history-cell"><Text>Başlangıç: {formatTime(run.startedAt)} · Bitiş: {formatTime(run.completedAt)}</Text><Text>Tamamlanan: {run.completedItems ?? 0} / {run.totalItems ?? 0} · Başarısız: {run.failedItems ?? 0}</Text>{run.sourceRuns?.map(source => <div key={source.id}><strong>{source.source.name}</strong> · {runStatuses[source.status] ?? source.status} · {source._count.documents} belge{source.errorSummary && <Text type="danger"> · {source.errorSummary}</Text>}</div>)}</div> }} />
}
export function AutomationDetailPage() {
  const { id } = useParams()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<string>()
  const loader = useCallback(() => workspaceRequest<{ automation: WorkspaceAutomation | null; runs: AutomationRun[]; total: number; operations?: OperationRequest[] }>(`automations/${id}?page=${page}${status ? `&status=${status}` : ''}`), [id, page, status])
  const resource = useResource(loader, { automation: null, runs: [], total: 0 })
  useEffect(() => { const timer = setInterval(() => void resource.refresh(), 10000); return () => clearInterval(timer) }, [resource.refresh])
  const sources = useResource(listSources, { sources: [] })
  const groups = useResource(listCustomerGroups, [])
  const templates = useResource(listTemplates, { templates: [], components: [] })
  const [open, setOpen] = useState(false)
  const runAttempt = useRef<{ id: string | undefined; key: string } | null>(null)
  const [running, setRunning] = useState(false)
  const [feedback, holder] = message.useMessage()
  const navigate = useNavigate()
  const item = resource.data.automation
  const toggle = async (isActive: boolean) => {
    try { await workspaceRequest(`automations/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive }) }); await resource.refresh() } catch (caught) { void feedback.error((caught as Error).message) }
  }
  const run = async () => {
    if (!runAttempt.current || runAttempt.current.id !== id) runAttempt.current = { id, key: crypto.randomUUID() }
    setRunning(true)
    try { const created = await workspaceRequest<{ runId: string }>(`automations/${id}/run`, { method: 'POST', body: JSON.stringify({ requestKey: runAttempt.current.key }) }); runAttempt.current = null; navigate(`/runs/${created.runId}`) } catch (caught) { void feedback.error((caught as Error).message) } finally { setRunning(false) }
  }
  const remove = async () => {
    try { await workspaceRequest(`automations/${id}`, { method: 'DELETE' }); navigate('/automations') } catch (caught) { void feedback.error((caught as Error).message) }
  }
  return <div className="atez-demo-page">{holder}<PageToolbar backTo="/automations" backLabel="Otomasyonlara dön" /><LoadError error={resource.error} retry={() => void resource.refresh()} />{item && <><PageHeading title={item.name} description={scheduleLabel(item)} action={<Space wrap><Can permission="config.manage"><Switch aria-label="Otomasyonu etkinleştir" checked={item.isActive} onChange={value => void toggle(value)} /></Can><Can permission="config.manage"><Button icon={<EditOutlined />} onClick={() => setOpen(true)}>Düzenle</Button></Can><Can permission="scan.run"><Button type="primary" loading={running} icon={<PlayCircleOutlined />} onClick={() => void run()}>Şimdi çalıştır</Button></Can><Can permission="config.manage"><Popconfirm title="Otomasyon kaldırılsın mı?" description="Yeni çalışmalar durdurulur; raporlar ve çalışma geçmişi korunur." okText="Kaldır" cancelText="Vazgeç" onConfirm={() => void remove()}><Button danger icon={<DeleteOutlined />} aria-label="Otomasyonu kaldır" /></Popconfirm></Can></Space>} />{item.lastError && <Alert showIcon type="error" title={item.lastError} style={{ marginBottom: 18 }} />}<Card title="Rapor ve çalışma geçmişi" style={{ marginBottom: 18 }} extra={<Button icon={<ReloadOutlined />} onClick={() => void resource.refresh()}>Yenile</Button>}><div className="atez-history-filters"><Select aria-label="Çalışma durumuna göre filtrele" placeholder="Tüm durumlar" allowClear value={status} onChange={value => { setStatus(value); setPage(1) }} options={Object.entries(runStatuses).map(([value, label]) => ({ value, label }))} /><Text type="secondary">{resource.data.total} çalışma · 10 saniyede bir güncellenir.</Text></div><RunHistory runs={resource.data.runs} automations={[item]} loading={resource.loading} pagination={{ current: page, pageSize: 10, total: resource.data.total, onChange: setPage, showSizeChanger: false }} /></Card><Row gutter={[16, 16]}><Col xs={24} lg={8}><Card title="Kaynaklar">{item.sourceIds.map(sourceId => <Tag key={sourceId}>{sources.data.sources.find(source => source.id === sourceId)?.name || sourceId}</Tag>)}</Card></Col><Col xs={24} lg={8}><Card title="Rapor şablonu">{templates.data.templates.find(template => template.id === item.templateId)?.name || 'ATEZ standart bülten'}</Card></Col><Col xs={24} lg={8}><Card title="Önerilen alıcı grupları">{item.groupIds.map(groupId => <Tag key={groupId}>{groups.data.find(group => group.id === groupId)?.name || groupId}</Tag>)}{!item.groupIds.length && <Text type="secondary">Rapor gönderiminde seçilir.</Text>}</Card></Col></Row><AutomationStagePanel automation={item} sources={sources.data.sources} operations={resource.data.operations} /><AutomationEditor open={open} item={item} onClose={() => setOpen(false)} onSaved={() => void resource.refresh()} /></>}</div>
}
