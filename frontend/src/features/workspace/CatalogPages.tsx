import { useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography, message } from 'antd'
import { EditOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { listUsers, workspaceRequest } from './api'
import type { WorkspaceUser } from './api'
import { useResource } from './useResource'
import './workspace.css'
const { Title, Paragraph } = Typography

export function PageHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="atez-demo-heading"><div><Title level={1}>{title}</Title><Paragraph type="secondary">{description}</Paragraph></div>{action}</div>
}
export function LoadError({ error, retry }: { error: string | null; retry: () => void }) {
  return error ? <Alert type="error" showIcon title={error} action={<Button size="small" onClick={retry}>Yeniden dene</Button>} style={{ marginBottom: 18 }} /> : null
}

export { ConnectorsPage as SourcesPage } from './ConnectorsPage'

export { TemplatesPage } from './TemplatesPage'

export { UsagePage } from './UsagePage'

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
