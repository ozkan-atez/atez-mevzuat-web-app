import { SemanticSectionEditor } from './SemanticSectionEditor'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Button, Card, Col, Empty, Form, Input, Modal, Row, Select, Space, Spin, Switch, Table, Tag, Typography, message } from 'antd'
import { EditOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { listTemplates, listUsers, workspaceRequest } from './api'
import type { TemplateSection, WorkspaceTemplate, WorkspaceUser } from './api'
import { useResource } from './useResource'
import './workspace.css'
import { VisualTemplateEditor } from './VisualTemplateEditor'
const { Title, Text, Paragraph } = Typography

export function PageHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="atez-demo-heading"><div><Title level={1}>{title}</Title><Paragraph type="secondary">{description}</Paragraph></div>{action}</div>
}
export function LoadError({ error, retry }: { error: string | null; retry: () => void }) {
  return error ? <Alert type="error" showIcon title={error} action={<Button size="small" onClick={retry}>Yeniden dene</Button>} style={{ marginBottom: 18 }} /> : null
}

export { SourcesPage } from './SourcesPage'

const defaultHtml = '<article class="report"><h1>{{title}}</h1><p>{{date}}</p>{{sections}}</article>'
export function TemplatesPage() {
  const resource = useResource(listTemplates, { templates: [], components: [], defaultHtml: undefined, defaultSections: undefined })
  const corporateHtml = resource.data.defaultHtml ?? defaultHtml
  const [editing, setEditing] = useState<WorkspaceTemplate | 'new' | null>(null)
  const [suggesting,setSuggesting]=useState(false)
  const [suggestion,setSuggestion]=useState<TemplateSection[]|null>(null)
  const [preview, setPreview] = useState<WorkspaceTemplate | null>(null)
  const [sections, setSections] = useState<TemplateSection[]>([])
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const templateName = Form.useWatch('name', form) as string | undefined
  const [feedback, holder] = message.useMessage()
  const open = (template: WorkspaceTemplate | 'new') => {
    setEditing(template)
    setSuggestion(null)
    setSections(template === 'new' ? (resource.data.defaultSections ?? resource.data.components.filter(section => ['type','title','summary','impact','note','sources'].includes(section.id))).map(section => ({ ...section })) : structuredClone(template.sections))
    form.setFieldsValue(template === 'new' ? { name: '', description: '', html: corporateHtml, isActive: true } : { ...template, html: corporateHtml })
  }
  const save = async (values: Record<string, unknown>) => {
    setSaving(true)
    try {
      await workspaceRequest(editing === 'new' ? 'templates' : `templates/${(editing as WorkspaceTemplate).id}`, { method: editing === 'new' ? 'POST' : 'PATCH', body: JSON.stringify({ ...values, revision: editing!=='new'? (editing as WorkspaceTemplate).revision : undefined, html: corporateHtml, sections:sections.map((section,order)=>({...section,order})) }) })
      setEditing(null); await resource.refresh(); void feedback.success('Şablon kaydedildi.')
    } catch (caught) { void feedback.error((caught as Error).message) } finally { setSaving(false) }
  }
  const renderPreview = (template: WorkspaceTemplate) => corporateHtml.replaceAll('{{title}}', template.name.replace(/[<>&]/g, '')).replaceAll('{{reportId}}', 'Önizleme').replaceAll('{{issueNumber}}', 'Yayın numarası').replaceAll('{{date}}', new Date().toLocaleDateString('tr-TR')).replaceAll('{{sections}}', template.sections.filter(section => section.enabled).map(section => section.html.replaceAll('{{heading}}', section.heading.replace(/[<>&]/g, '')).replaceAll('{{content}}', '<p>Rapor oluşturulurken bu alana ilgili içerik eklenir.</p>')).join(''))
  return <div className="atez-demo-page">{holder}<PageHeading title="Rapor şablonları" description="Raporun bölümlerini ve her bölümde anlatılmasını istediğiniz bilgileri tanımlayın." action={<Button type="primary" icon={<PlusOutlined />} disabled={resource.loading || Boolean(resource.error)} onClick={() => open('new')}>Şablon oluştur</Button>} /><LoadError error={resource.error} retry={() => void resource.refresh()} />
    <Spin spinning={resource.loading}><Row gutter={[18, 18]}>{resource.data.templates.map(template => <Col xs={24} lg={12} key={template.id}><Card className="atez-template-card"><Tag color={template.isActive ? 'success' : 'default'}>{template.isActive ? 'Aktif' : 'Pasif'}</Tag><Title level={3}>{template.name}</Title><Paragraph type="secondary">{template.description}</Paragraph><Space wrap>{template.sections.filter(section => section.enabled).map(section => <Tag key={section.id}>{section.heading}</Tag>)}</Space><div className="atez-source-footer"><Button onClick={() => setPreview(template)}>Önizle</Button><Button type="link" icon={<EditOutlined />} onClick={() => open(template)}>Şablonu düzenle</Button></div></Card></Col>)}</Row>{!resource.loading && resource.data.templates.length === 0 && <Empty description="Kayıtlı şablon yok." />}</Spin>
    <Modal className="atez-visual-editor-modal" title={editing === 'new' ? 'Şablon oluştur' : 'Şablonu düzenle'} open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => form.submit()} confirmLoading={saving} okText="Şablonu kaydet" cancelText="Vazgeç" width={1200}><Form form={form} layout="vertical" onFinish={save}><Row gutter={16}><Col span={16}><Form.Item name="name" label="Şablon adı" rules={[{ required: true }]}><Input /></Form.Item></Col><Col span={8}><Form.Item name="isActive" label="Aktif" valuePropName="checked"><Switch /></Form.Item></Col></Row><Form.Item name="description" label="Kullanım amacı"><Input /></Form.Item><Form.Item name="html" hidden><Input /></Form.Item><Space wrap style={{marginBottom:16}}><Button loading={suggesting} disabled={saving||!templateName||!sections.length} onClick={()=>{setSuggesting(true);setSuggestion(null);void workspaceRequest<{sections:TemplateSection[]}>('templates/suggest',{method:'POST',body:JSON.stringify({name:form.getFieldValue('name'),description:form.getFieldValue('description')??'',sections,requestKey:crypto.randomUUID()})}).then(result=>setSuggestion(result.sections)).catch(error=>{void feedback.error(error.message)}).finally(()=>setSuggesting(false))}}>AI ile yapıyı öner</Button><Text type="secondary">Öneriyi inceleyip uygulayabilirsiniz.</Text></Space>{suggestion&&<Alert type="info" showIcon title="AI önerisi hazır" description={<Space orientation="vertical">{suggestion.map(s=><Text key={s.id}><strong>{s.heading}:</strong> {s.description}</Text>)}<Space><Button onClick={()=>{setSections(suggestion);setSuggestion(null)}}>Öneriyi uygula</Button><Button onClick={()=>setSuggestion(null)}>Vazgeç</Button></Space></Space>} style={{marginBottom:16}}/>}<SemanticSectionEditor sections={sections} onChange={setSections} disabled={saving||suggesting}/><details style={{marginTop:20}}><summary>Görsel önizleme ve mevcut düzen</summary><VisualTemplateEditor contentOnly html={corporateHtml} title={templateName || 'Rapor başlığı'} sections={sections} components={resource.data.components} onChange={setSections} disabled={saving||suggesting} /></details></Form></Modal>
    <Modal title="Şablon önizlemesi" open={Boolean(preview)} onCancel={() => setPreview(null)} footer={<Button onClick={() => setPreview(null)}>Kapat</Button>} width={850}>{preview && <iframe title="Şablon önizlemesi" sandbox="" srcDoc={renderPreview(preview)} className="atez-template-frame" />}</Modal>
  </div>
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
