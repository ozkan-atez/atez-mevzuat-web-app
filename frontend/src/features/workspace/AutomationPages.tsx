import { PageToolbar } from '../../components/layout/PageToolbar'
import { Can } from '../auth/Can'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Col, Empty, Form, Input, Modal, Popconfirm, Row, Select, Space, Skeleton, Switch, Table, Tag, Typography, message } from 'antd'
import { DeleteOutlined, EditOutlined, PlayCircleOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { listCustomerGroups } from '../delivery/api'
import { getBackgroundStatus, listAutomations, listSources, listTemplates, workspaceRequest } from './api'
import type { WorkspaceAutomation } from './api'
import { useResource } from './useResource'
import { AutomationStagePanel } from './AutomationStagePanel'
import type { OperationRequest } from '../operations/api'
import { LoadError, PageHeading } from './CatalogPages'
import './workspace.css'
import './automations.css'
const { Text } = Typography
const queueLabels: Record<string, string> = { 'resmi-gazete-manual-scan': 'Tarama ve rapor üretimi', 'resmi-gazete-topic-analysis': 'Analiz ve revizyon', 'resmi-gazete-scheduled-scan': 'Standart zamanlanmış taramalar', 'atez-workspace-daily-automation': 'Özel cron işleri', 'atez-source-scan': 'Kaynak taraması', 'atez-source-refresh': 'Kaynak yenileme', 'atez-operation-task': 'Bağımsız işlem adımları' }
const dayOptions = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'].map((label, index) => ({ label, value: index + 1 }))
function scheduleLabel(item: WorkspaceAutomation) {
  const times = item.times?.length ? item.times : [`${String(item.hour).padStart(2, '0')}:${String(item.minute).padStart(2, '0')}`]
  const days = item.weekdays?.length ? item.weekdays : [1,2,3,4,5,6,7]
  return `${days.length === 7 ? 'Her gün' : days.map(day => dayOptions[day - 1]?.label).join(', ')} · ${times.join(', ')} · ${item.timezone}`
}
function BackgroundMonitor() {
  const resource = useResource(getBackgroundStatus, { broker: 'RabbitMQ', connected: false, queues: [], jobs: [] })
  const { refresh } = resource
  useEffect(() => { const timer = setInterval(() => void refresh(), 10000); return () => clearInterval(timer) }, [refresh])
  const ready = !resource.error && resource.data.connected
  const missingWorkers = resource.data.queues.some(queue => queue.consumers === 0)
  const failed = resource.data.queues.reduce((sum, queue) => sum + queue.failed, 0)
  const totals = [
    { label: 'Bekleyen', value: resource.data.queues.reduce((sum, queue) => sum + queue.waiting, 0) },
    { label: 'Çalışıyor', value: resource.data.jobs.filter(job => job.status === 'RUNNING').length },
    { label: 'Tekrar bekleyen', value: resource.data.queues.reduce((sum, queue) => sum + queue.retrying, 0) },
    { label: 'Başarısız', value: failed },
  ]
  return <Card className="atez-automation-card atez-background-monitor" title="Arka plan işleri · RabbitMQ" extra={<Button size="small" onClick={() => void refresh()} loading={resource.loading} icon={<ReloadOutlined />}>Yenile</Button>}>
    <LoadError error={resource.error} retry={() => void refresh()} />
    {resource.loading && !resource.data.connected && !resource.error && <Skeleton active paragraph={{ rows: 2 }} title={false} />}
    {ready && <>
      <Alert className="atez-monitor-status" type={missingWorkers || failed > 0 ? 'warning' : 'success'} showIcon title={missingWorkers ? 'Bazı kuyruklarda çalışan bulunmuyor.' : failed > 0 ? 'İncelenmesi gereken başarısız işler var.' : 'RabbitMQ bağlı, tüm iş kuyruklarında çalışan var.'} />
      <div className="atez-monitor-metrics">{totals.map(total => <div key={total.label}><span>{total.label}</span><strong>{total.value}</strong></div>)}</div>
      <details className="atez-monitor-details"><summary>Kuyruk ve çalışma ayrıntıları</summary>
        <Table size="small" rowKey="name" pagination={false} dataSource={resource.data.queues} scroll={{ x: 550 }} columns={[
          { title: 'İş kuyruğu', dataIndex: 'name', render: (name: string) => queueLabels[name] ?? name }, { title: 'Bekleyen', dataIndex: 'waiting' }, { title: 'Çalışan', dataIndex: 'consumers' }, { title: 'Tekrar', dataIndex: 'retrying' }, { title: 'Başarısız', dataIndex: 'failed' },
        ]} locale={{ emptyText: 'Kuyruk bilgisi alınamadı.' }} />
        {!!resource.data.jobs.length && <Table size="small" rowKey="id" pagination={{ pageSize: 5, size: 'small', showSizeChanger: false }} dataSource={resource.data.jobs} scroll={{ x: 550 }} columns={[
          { title: 'İş', dataIndex: 'queue', render: (name: string) => queueLabels[name] ?? name }, { title: 'Durum', render: (_, job) => <Tag color={job.status === 'FAILED' ? 'error' : 'processing'}>{job.status === 'RUNNING' && new Date(job.leaseUntil).valueOf() < Date.now() ? 'Çalışan bağlantısı kesildi' : job.status === 'RUNNING' ? 'Çalışıyor' : job.status === 'RETRY' ? 'Tekrar bekliyor' : 'Başarısız'}</Tag> }, { title: 'Deneme', dataIndex: 'attempts' }, { title: 'Hata', dataIndex: 'lastError', ellipsis: true },
        ]} />}
      </details>
      <Text type="secondary" className="atez-monitor-note">10 saniyede bir güncellenir. Başarısız taramaları çalışma ayrıntısından yeniden başlatabilirsiniz.</Text>
    </>}
  </Card>
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
  return <Modal title={item ? 'Otomasyonu düzenle' : 'Cron işi oluştur'} open={open} onCancel={onClose} onOk={() => form.submit()} okText="Kaydet" cancelText="Vazgeç" confirmLoading={saving} destroyOnHidden afterOpenChange={visible => { if (visible) form.setFieldsValue(values) }}><LoadError error={sources.error || templates.error || groups.error} retry={() => { void sources.refresh(); void templates.refresh(); void groups.refresh() }} />{error && <Alert type="error" title={error} style={{ marginBottom: 12 }} />}<Form form={form} layout="vertical" onFinish={save} initialValues={values}><Form.Item name="name" label="Otomasyon adı" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="sourceIds" label="Taranacak kaynaklar" rules={[{ required: true, type: 'array', min: 1, message: 'En az bir kaynak seçin.' }]}><Select mode="multiple" options={sources.data.sources.filter(source => source.isActive).map(source => ({ value: source.id, label: `${source.name}${source.scanSupported ? '' : ' · otomatik tarama desteklenmiyor'}`, disabled: !source.scanSupported }))} /></Form.Item><Form.Item name="datePolicy" label="İçerik seçimi" extra="Resmî Gazete seçilen günün sayıları üzerinden taranır; bu seçim diğer kaynaklara uygulanır."><Select options={[{value:"PUBLISHED_DATE",label:"Seçilen gün yayımlananlar"},{value:"NEW_OR_CHANGED",label:"Yeni veya değişen içerikler (tarihsizler dahil)"}]} /></Form.Item><Form.Item name="times" label="Tekrar saatleri" rules={[{ required: true, type: 'array', min: 1, max: 24, message: 'En az bir saat girin (SS:DD).' }, { validator: async (_, times: string[]) => { if (times?.some(time => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new Error('Saatleri 08:30 gibi SS:DD biçiminde girin.') } }]}><Select mode="tags" tokenSeparators={[',']} placeholder="08:00, 12:30, 18:00" options={['04:00','08:00','12:00','18:00','23:00'].map(value => ({ value, label: value }))} /></Form.Item><Form.Item name="weekdays" label="Tekrar günleri" rules={[{ required: true, type: 'array', min: 1, message: 'En az bir gün seçin.' }]}><Select mode="multiple" options={dayOptions} /></Form.Item><Form.Item name="isActive" label="Etkin" valuePropName="checked"><Switch /></Form.Item><Form.Item name="timezone" label="Saat dilimi"><Select options={[{ value: 'Europe/Istanbul', label: 'İstanbul (UTC+3)' }]} /></Form.Item><Form.Item name="templateId" label="Rapor şablonu"><Select allowClear options={templates.data.templates.filter(template => template.isActive).map(template => ({ value: template.id, label: template.name }))} /></Form.Item><Form.Item name="groupIds" label="Önerilen alıcı grupları"><Select mode="multiple" options={groups.data.filter(group => group.isActive).map(group => ({ value: group.id, label: group.name }))} /></Form.Item><Text type="secondary">Raporlar incelemeye açılır. E-posta gönderimi rapor çalışma alanından onaylanır.</Text></Form></Modal>
}

export function AutomationsPage() {
  const resource = useResource(listAutomations, { automations: [], builtInSchedules: [] })
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  return <div className="atez-demo-page atez-automations-page">
    <PageHeading title="Otomasyonlar" description="Kaynak, tekrar günü ve saat seçerek tarama işlerini yönetin." action={<Space wrap><Button icon={<ReloadOutlined />} onClick={() => void resource.refresh()}>Yenile</Button><Can permission="config.manage"><Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Otomasyon oluştur</Button></Can></Space>} />
    <LoadError error={resource.error} retry={() => void resource.refresh()} />
    <div className="atez-schedule-grid">{resource.data.builtInSchedules.map(slot => <Card size="small" className="atez-schedule-card" key={slot.key}>
      <div className="atez-schedule-top"><strong>{slot.label}</strong><Tag>Günlük</Tag></div>
      <div className="atez-schedule-time">{String(slot.hour).padStart(2, '0')}:{String(slot.minute).padStart(2, '0')}<span>İstanbul</span></div>
      <p title={slot.description}>{slot.description}</p>
    </Card>)}</div>
    <Card className="atez-automation-card" title="Özel cron işleri" extra={<Text type="secondary">{resource.data.automations.length} otomasyon</Text>}>
      {!resource.loading && !resource.data.automations.length ? <div className="atez-automation-empty"><p>Henüz özel otomasyon yok. Kaynak ve saat seçerek ilk işinizi oluşturun.</p><Can permission="config.manage"><Button size="small" onClick={() => setOpen(true)}>İlk otomasyonu ekle</Button></Can></div> : <Table size="small" rowKey="id" loading={resource.loading} dataSource={resource.data.automations} pagination={{ pageSize: 8, showSizeChanger: false }} scroll={{ x: 650 }} columns={[
        { title: 'Otomasyon', dataIndex: 'name' }, { title: 'Tekrar', render: (_, item) => <span className="atez-automation-recurrence">{scheduleLabel(item)}</span> },
        { title: 'Durum', dataIndex: 'isActive', render: value => <Tag color={value ? 'success' : 'default'}>{value ? 'Etkin' : 'Duraklatıldı'}</Tag> },
        { title: 'Son çalışma', dataIndex: 'lastRunAt', render: value => value ? new Date(value).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : 'Henüz çalışmadı' },
        { title: '', render: (_, item) => <Button size="small" onClick={() => navigate(`/automations/${item.id}`)}>Yönet</Button> },
      ]} expandable={{ rowExpandable: item => Boolean(item.lastError), expandedRowRender: item => <Alert type="error" showIcon title={item.lastError} /> }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Henüz özel otomasyon yok. Kaynak ve saat seçerek ilk işinizi oluşturun." /> }} />}
    </Card>
    <Can permission="admin.manage"><BackgroundMonitor /></Can>
    <AutomationEditor open={open} item={null} onClose={() => setOpen(false)} onSaved={() => void resource.refresh()} />
  </div>

}

type AutomationRun = { id: string; targetDate: string; status: string; createdAt: string; errorSummary: string | null }
export function AutomationDetailPage() {
  const { id } = useParams()
  const loader = useCallback(() => workspaceRequest<{ automation: WorkspaceAutomation | null; runs: AutomationRun[]; operations?: OperationRequest[] }>(`automations/${id}`), [id])
  const resource = useResource(loader, { automation: null, runs: [] })
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
  return <div className="atez-demo-page">{holder}<PageToolbar backTo="/automations" backLabel="Otomasyonlara dön" /><LoadError error={resource.error} retry={() => void resource.refresh()} />{item && <><PageHeading title={item.name} description={scheduleLabel(item)} action={<Space wrap><Can permission="config.manage"><Switch aria-label="Otomasyonu etkinleştir" checked={item.isActive} onChange={value => void toggle(value)} /></Can><Can permission="config.manage"><Button icon={<EditOutlined />} onClick={() => setOpen(true)}>Düzenle</Button></Can><Can permission="scan.run"><Button type="primary" loading={running} icon={<PlayCircleOutlined />} onClick={() => void run()}>Şimdi çalıştır</Button></Can><Can permission="config.manage"><Popconfirm title="Otomasyon kaldırılsın mı?" okText="Kaldır" cancelText="Vazgeç" onConfirm={() => void remove()}><Button danger icon={<DeleteOutlined />} aria-label="Otomasyonu kaldır" /></Popconfirm></Can></Space>} />{item.lastError && <Alert showIcon type="error" title={item.lastError} style={{ marginBottom: 18 }} />}<Row gutter={[16, 16]}><Col xs={24} lg={8}><Card title="Kaynaklar">{item.sourceIds.map(sourceId => <Tag key={sourceId}>{sources.data.sources.find(source => source.id === sourceId)?.name || sourceId}</Tag>)}</Card></Col><Col xs={24} lg={8}><Card title="Rapor şablonu">{templates.data.templates.find(template => template.id === item.templateId)?.name || 'ATEZ standart bülten'}</Card></Col><Col xs={24} lg={8}><Card title="Önerilen alıcı grupları">{item.groupIds.map(groupId => <Tag key={groupId}>{groups.data.find(group => group.id === groupId)?.name || groupId}</Tag>)}{!item.groupIds.length && <Text type="secondary">Rapor gönderiminde seçilir.</Text>}</Card></Col></Row><AutomationStagePanel automation={item} sources={sources.data.sources} operations={resource.data.operations} /><Card title="Çalışma geçmişi" style={{ marginTop: 18 }}><Table rowKey="id" dataSource={resource.data.runs} columns={[{ title: 'Tarih', dataIndex: 'targetDate', render: value => String(value).slice(0, 10) }, { title: 'Durum', dataIndex: 'status', render: value => <Tag>{value}</Tag> }, { title: 'Hata', dataIndex: 'errorSummary' }, { title: '', render: (_, row) => <Link to={`/runs/${row.id}`}>İncele</Link> }]} /></Card><AutomationEditor open={open} item={item} onClose={() => setOpen(false)} onSaved={() => void resource.refresh()} /></>}</div>
}
