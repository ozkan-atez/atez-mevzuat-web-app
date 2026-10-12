import { Can } from '../auth/Can'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Button, Card, Col, Empty, Form, Input, Modal, Row, Select, Space, Spin, Switch, Table, Tabs, Tag, Typography, message } from 'antd'
import { EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getUsage, listSources, listTemplates, listUsers, workspaceRequest } from './api'
import type { TemplateSection, WorkspaceSource, WorkspaceTemplate, WorkspaceUser } from './api'
import { useResource } from './useResource'
import './workspace.css'
import { SourceActions } from './SourceActions'
import { ManagedSourcesPanel } from './ManagedSourcesPanel'
import { SourceRunsPanel } from './SourceRunsPanel'
import { VisualTemplateEditor } from './VisualTemplateEditor'
const { Title, Text, Paragraph } = Typography

export function PageHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="atez-demo-heading"><div><Title level={1}>{title}</Title><Paragraph type="secondary">{description}</Paragraph></div>{action}</div>
}
export function LoadError({ error, retry }: { error: string | null; retry: () => void }) {
  return error ? <Alert type="error" showIcon title={error} action={<Button size="small" onClick={retry}>Yeniden dene</Button>} style={{ marginBottom: 18 }} /> : null
}

export function SourcesPage() {
  const resource = useResource(listSources, { sources: [] })
  const [editing, setEditing] = useState<WorkspaceSource | 'new' | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const [feedback, holder] = message.useMessage()
  const open = (source: WorkspaceSource | 'new') => {
    setEditing(source)
    form.setFieldsValue(source === 'new' ? { name: '', key: '', baseUrl: '', description: '', authorityType: 'REFERENCE', isActive: true } : source)
  }
  const save = async (values: Record<string, unknown>) => {
    setSaving(true)
    try {
      await workspaceRequest(editing === 'new' ? 'sources' : `sources/${(editing as WorkspaceSource).id}`, { method: editing === 'new' ? 'POST' : 'PATCH', body: JSON.stringify(values) })
      setEditing(null); await resource.refresh(); void feedback.success('Kaynak kaydedildi.')
    } catch (caught) { void feedback.error((caught as Error).message) } finally { setSaving(false) }
  }
  return <div className="atez-demo-page">{holder}<PageHeading title="Kaynaklar" description="Tarama ve raporlarda kullanılan kaynaklar. Ek kaynakları rapor çalışma alanından bağlayabilirsiniz." action={<Space wrap><Button icon={<ReloadOutlined />} onClick={() => void resource.refresh()}>Yenile</Button><Can permission="config.manage"><Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>Kaynak sitesi ekle</Button></Can></Space>} />
    <LoadError error={resource.error} retry={() => void resource.refresh()} />
    <Spin spinning={resource.loading}><Row gutter={[18, 18]}>{resource.data.sources.map(source => <Col xs={24} lg={12} key={source.id}><Card className="atez-source-card"><div className="atez-source-top"><Text className="atez-kicker">{source.authorityType === 'OFFICIAL' ? 'RESMÎ KAYNAK' : 'DESTEKLEYİCİ KAYNAK'}</Text><Tag color={source.isActive ? 'success' : 'default'}>{source.isActive ? 'Aktif' : 'Pasif'}</Tag></div><Title level={3}>{source.name || source.key}</Title><Paragraph type="secondary">{source.description || 'Rapor kaynak kataloğuna kayıtlı.'}</Paragraph><a href={source.baseUrl} target="_blank" rel="noreferrer">{source.baseUrl}</a><div style={{ marginTop: 16 }}><SourceActions source={source} onChanged={() => void resource.refresh()} /></div><div className="atez-source-footer"><Text type="secondary">{source.scanSupported ? 'Otomatik tarama destekleniyor' : 'Raporlara ek kaynak olarak bağlanabilir'}</Text><Can permission="config.manage"><Button type="link" icon={<EditOutlined />} onClick={() => open(source)}>Düzenle</Button></Can></div>{source.lastScanned && <Text type="secondary">Son tarama: {new Date(source.lastScanned).toLocaleString('tr-TR')}</Text>}</Card></Col>)}</Row>{!resource.loading && resource.data.sources.length === 0 && <Empty description="Kayıtlı kaynak yok." />}</Spin>
    <Tabs style={{ marginTop: 24 }} items={[{ key: 'managed', label: 'Eklenen kaynak bağlantıları', children: <ManagedSourcesPanel /> }, { key: 'runs', label: 'Kaynak tarama geçmişi', children: <SourceRunsPanel /> }]} />
    <Modal title={editing === 'new' ? 'Kaynak ekle' : 'Kaynağı düzenle'} open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={saving} okText="Kaydet" cancelText="Vazgeç"><Form form={form} layout="vertical" onFinish={save}><Form.Item name="name" label="Kaynak adı" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="key" label="Kısa kod" rules={[{ required: true }]}><Input placeholder="ticaret-bakanligi" /></Form.Item><Form.Item name="baseUrl" label="Kaynak bağlantısı" rules={[{ required: true }, { type: 'url' }]}><Input /></Form.Item><Form.Item name="description" label="Açıklama"><Input.TextArea rows={3} /></Form.Item><Form.Item name="authorityType" label="Kaynak türü"><Select options={[{ value: 'OFFICIAL', label: 'Resmî kaynak' }, { value: 'REFERENCE', label: 'Destekleyici kaynak' }, { value: 'PROFESSIONAL', label: 'Meslek kuruluşu' }, { value: 'COMMERCIAL', label: 'Ticari kaynak' }, { value: 'UNVERIFIED', label: 'Doğrulanmamış kaynak' }]} /></Form.Item><Form.Item name="isActive" label="Aktif" valuePropName="checked"><Switch /></Form.Item></Form></Modal>
  </div>
}

const defaultHtml = '<article class="report"><h1>{{title}}</h1><p>{{date}}</p>{{sections}}</article>'
export function TemplatesPage() {
  const resource = useResource(listTemplates, { templates: [], components: [], defaultHtml: undefined, defaultSections: undefined })
  const corporateHtml = resource.data.defaultHtml ?? defaultHtml
  const [editing, setEditing] = useState<WorkspaceTemplate | 'new' | null>(null)
  const [preview, setPreview] = useState<WorkspaceTemplate | null>(null)
  const [sections, setSections] = useState<TemplateSection[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const templateName = Form.useWatch('name', form) as string | undefined
  const [feedback, holder] = message.useMessage()
  const open = (template: WorkspaceTemplate | 'new') => {
    setEditing(template)
    setSections(template === 'new' ? (resource.data.defaultSections ?? resource.data.components.filter(section => ['type','title','summary','impact','note','sources'].includes(section.id))).map(section => ({ ...section })) : structuredClone(template.sections))
    form.setFieldsValue(template === 'new' ? { name: '', description: '', html: corporateHtml, isActive: true } : { ...template, html: corporateHtml })
  }
  const save = async (values: Record<string, unknown>) => {
    setSaving(true)
    try {
      await workspaceRequest(editing === 'new' ? 'templates' : `templates/${(editing as WorkspaceTemplate).id}`, { method: editing === 'new' ? 'POST' : 'PATCH', body: JSON.stringify({ ...values, html: corporateHtml, sections }) })
      setEditing(null); await resource.refresh(); void feedback.success('Şablon kaydedildi.')
    } catch (caught) { void feedback.error((caught as Error).message) } finally { setSaving(false) }
  }
  const renderPreview = (template: WorkspaceTemplate) => corporateHtml.replaceAll('{{title}}', template.name.replace(/[<>&]/g, '')).replaceAll('{{reportId}}', 'Önizleme').replaceAll('{{issueNumber}}', 'Yayın numarası').replaceAll('{{date}}', new Date().toLocaleDateString('tr-TR')).replaceAll('{{sections}}', template.sections.filter(section => section.enabled).map(section => section.html.replaceAll('{{heading}}', section.heading.replace(/[<>&]/g, '')).replaceAll('{{content}}', '<p>Rapor oluşturulurken bu alana ilgili içerik eklenir.</p>')).join(''))
  return <div className="atez-demo-page">{holder}<PageHeading title="Rapor şablonları" description="Hazır bülten bileşenlerini ekleyin ve içeriklerini düzenleyin. ATEZ logosu, kurumsal tasarım ve alt bilgiler sabittir." action={<Button type="primary" icon={<PlusOutlined />} disabled={resource.loading || Boolean(resource.error)} onClick={() => open('new')}>Şablon oluştur</Button>} /><LoadError error={resource.error} retry={() => void resource.refresh()} />
    <Spin spinning={resource.loading}><Row gutter={[18, 18]}>{resource.data.templates.map(template => <Col xs={24} lg={12} key={template.id}><Card className="atez-template-card"><Tag color={template.isActive ? 'success' : 'default'}>{template.isActive ? 'Aktif' : 'Pasif'}</Tag><Title level={3}>{template.name}</Title><Paragraph type="secondary">{template.description}</Paragraph><Space wrap>{template.sections.filter(section => section.enabled).map(section => <Tag key={section.id}>{section.heading}</Tag>)}</Space><div className="atez-source-footer"><Button onClick={() => setPreview(template)}>Önizle</Button><Button type="link" icon={<EditOutlined />} onClick={() => open(template)}>Şablonu düzenle</Button></div></Card></Col>)}</Row>{!resource.loading && resource.data.templates.length === 0 && <Empty description="Kayıtlı şablon yok." />}</Spin>
    <Modal className="atez-visual-editor-modal" title={editing === 'new' ? 'Şablon oluştur' : 'Şablonu düzenle'} open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={saving} okText="Şablonu kaydet" cancelText="Vazgeç" width={1200}><Form form={form} layout="vertical" onFinish={save}><Row gutter={16}><Col span={16}><Form.Item name="name" label="Şablon adı" rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={8}><Form.Item name="isActive" label="Aktif" valuePropName="checked"><Switch /></Form.Item></Col></Row><Form.Item name="description" label="Kullanım amacı"><Input /></Form.Item><Form.Item name="html" hidden><Input /></Form.Item><VisualTemplateEditor contentOnly html={corporateHtml} title={templateName || 'Rapor başlığı'} sections={sections} components={resource.data.components} onChange={setSections} disabled={saving} /></Form></Modal>
    <Modal title="Şablon önizlemesi" open={Boolean(preview)} onCancel={() => setPreview(null)} footer={<Button onClick={() => setPreview(null)}>Kapat</Button>} width={850}>{preview && <iframe title="Şablon önizlemesi" sandbox="" srcDoc={renderPreview(preview)} className="atez-template-frame" />}</Modal>
  </div>
}

const emptyUsage = { runs: 0, reports: 0, documents: 0, groups: 0, dispatches: 0, sessions: 0, inputTokens: 0, outputTokens: 0, storedBytes: 0 }
export function UsagePage() {
  const resource = useResource(getUsage, emptyUsage)
  const data = resource.data
  return <div className="atez-demo-page"><PageHeading title="Kullanım" description="Kayıtlı taramalar, raporlar ve sağlayıcının bildirdiği AI kullanımı." action={<Button icon={<ReloadOutlined />} onClick={() => void resource.refresh()}>Yenile</Button>} /><LoadError error={resource.error} retry={() => void resource.refresh()} /><Spin spinning={resource.loading}><div className="atez-metric-grid">{[['Toplam token', data.inputTokens + data.outputTokens], ['Rapor', data.reports], ['Tarama', data.runs], ['Belge', data.documents]].map(([label, value]) => <Card key={String(label)}><Text type="secondary">{label}</Text><div className="atez-metric-value">{Number(value).toLocaleString('tr-TR')}</div></Card>)}</div><Card title="İşlem ve depolama özeti"><Table pagination={false} rowKey="label" dataSource={[{ label: 'Girdi token', value: data.inputTokens }, { label: 'Çıktı token', value: data.outputTokens }, { label: 'Dağıtım grubu', value: data.groups }, { label: 'E-posta gönderim kaydı', value: data.dispatches }, { label: 'Genel sohbet', value: data.sessions }, { label: 'Arşiv boyutu (MB)', value: Math.round(Number(data.storedBytes) / 1024 / 1024) }]} columns={[{ title: 'Kayıt', dataIndex: 'label' }, { title: 'Toplam', dataIndex: 'value', render: value => Number(value).toLocaleString('tr-TR') }]} /></Card></Spin></div>
}

export function AdminPage() {
  const resource = useResource(listUsers, { users: [] })
  const navigate = useNavigate()
  const [editing, setEditing] = useState<WorkspaceUser | 'new' | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const [feedback, holder] = message.useMessage()
  const open = (user: WorkspaceUser | 'new') => { setEditing(user); form.setFieldsValue(user === 'new' ? { name: '', email: '', role: 'VIEWER', isActive: true } : user) }
  const save = async (values: Record<string, unknown>) => {
    setSaving(true)
    try { await workspaceRequest(editing === 'new' ? 'users' : `users/${(editing as WorkspaceUser).id}`, { method: editing === 'new' ? 'POST' : 'PATCH', body: JSON.stringify(values) }); setEditing(null); await resource.refresh(); void feedback.success('Kullanıcı kaydedildi.') }
    catch (caught) { void feedback.error((caught as Error).message) } finally { setSaving(false) }
  }
  return <div className="atez-demo-page">{holder}<PageHeading title="Yönetim" description="Kayıtlı kullanıcılar ve çalışma alanı ayarları." action={<Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>Kullanıcı ekle</Button>} /><LoadError error={resource.error} retry={() => void resource.refresh()} /><Card title="Kullanıcılar"><Table loading={resource.loading} rowKey="id" dataSource={resource.data.users} scroll={{ x: 600 }} columns={[{ title: 'Ad', dataIndex: 'name' }, { title: 'E-posta', dataIndex: 'email' }, { title: 'Rol', dataIndex: 'role' }, { title: 'Durum', dataIndex: 'isActive', render: value => <Tag color={value ? 'success' : 'default'}>{value ? 'Aktif' : 'Pasif'}</Tag> }, { title: '', render: (_, row) => <Button icon={<EditOutlined />} onClick={() => open(row)}>Düzenle</Button> }]} /></Card><Space wrap style={{ marginTop: 18 }}><Button onClick={() => navigate('/groups')}>Dağıtım grupları</Button><Button onClick={() => navigate('/templates')}>Rapor şablonları</Button><Button onClick={() => navigate('/sources')}>Kaynak kataloğu</Button></Space><Modal title={editing === 'new' ? 'Kullanıcı ekle' : 'Kullanıcıyı düzenle'} open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={saving} okText="Kaydet" cancelText="Vazgeç"><Form form={form} layout="vertical" onFinish={save}><Form.Item name="name" label="Ad soyad" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="email" label="E-posta" rules={[{ required: true, type: 'email' }]}><Input /></Form.Item><Form.Item name="role" label="Rol"><Select options={[{ value: 'ADMIN', label: 'Yönetici' }, { value: 'EDITOR', label: 'Editör' }, { value: 'VIEWER', label: 'Görüntüleyici' }]} /></Form.Item><Form.Item name="isActive" label="Aktif" valuePropName="checked"><Switch /></Form.Item></Form></Modal></div>
}
