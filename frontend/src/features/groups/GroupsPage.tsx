import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Empty, Form, Input, Modal, Space, Spin, Switch, Tag, Typography, Alert } from 'antd'
import { EditOutlined, DeleteOutlined, PlusOutlined, TeamOutlined } from '@ant-design/icons'
import { createCustomerGroup, deleteCustomerGroup, listCustomerGroups, parseEmailList, updateCustomerGroup } from '../delivery/api'
import type { CustomerGroup } from '../delivery/types'
import './groups.css'

interface FormState { name: string; description: string; emails: string }
const EMPTY_FORM: FormState = { name: '', description: '', emails: '' }

export function GroupsPage() {
  const [groups, setGroups] = useState<CustomerGroup[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [isSaving, setIsSaving] = useState(false)
  const [modal, contextHolder] = Modal.useModal()

  const load = useCallback(async () => {
    setIsLoading(true)
    try { setGroups(await listCustomerGroups()); setError(null) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Müşteri grupları alınamadı') }
    finally { setIsLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const startCreate = () => { setEditingId('new'); setForm(EMPTY_FORM) }
  const startEdit = (group: CustomerGroup) => {
    setEditingId(group.id)
    setForm({ name: group.name, description: group.description ?? '', emails: group.emails.join(', ') })
  }
  const cancel = () => { setEditingId(null); setForm(EMPTY_FORM) }
  const save = async () => {
    const emails = parseEmailList(form.emails)
    if (!form.name.trim() || emails.length === 0 || isSaving) return
    setIsSaving(true); setError(null)
    try {
      const payload = { name: form.name.trim(), description: form.description.trim() || null, emails }
      if (editingId === 'new') await createCustomerGroup(payload)
      else if (editingId) await updateCustomerGroup(editingId, payload)
      cancel(); await load()
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Grup kaydedilemedi') }
    finally { setIsSaving(false) }
  }
  const remove = (group: CustomerGroup) => {
    modal.confirm({ title: 'Grup silinsin mi?', content: `“${group.name}” grubunu silmek istiyor musunuz?`, okText: 'Sil', okButtonProps: { danger: true }, cancelText: 'Vazgeç', onOk: async () => {
      setError(null)
      try { await deleteCustomerGroup(group.id); await load() }
      catch (caught) { setError(caught instanceof Error ? caught.message : 'Grup silinemedi') }
    } })
  }
  const toggleActive = async (group: CustomerGroup) => {
    setError(null)
    try { await updateCustomerGroup(group.id, { isActive: !group.isActive }); await load() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Grup güncellenemedi') }
  }
  return <div className="atez-groups">
    {contextHolder}
    <div className="atez-groups-header">
      <div><Typography.Title level={2}><TeamOutlined /> Dağıtım grupları</Typography.Title><Typography.Text type="secondary">Bülten dağıtımında kullanılan e-posta listelerini yönetin.</Typography.Text></div>
      <Button type="primary" icon={<PlusOutlined />} onClick={startCreate} disabled={editingId === 'new'}>Yeni Grup</Button>
    </div>
    {error && <Alert type="error" message={error} showIcon closable onClose={() => setError(null)} />}
    {editingId === 'new' && <GroupForm form={form} setForm={setForm} onSave={() => void save()} onCancel={cancel} isSaving={isSaving} />}
    {isLoading ? <div className="atez-groups-loading"><Spin tip="Gruplar yükleniyor…"><div /></Spin></div> : groups.length === 0 && editingId !== 'new' ? <Card><Empty description="Henüz müşteri grubu yok. Yeni Grup ile ekleyebilirsiniz." /></Card> : null}
    <div className="atez-groups-list">
      {groups.map((group) => editingId === group.id
        ? <GroupForm key={group.id} form={form} setForm={setForm} onSave={() => void save()} onCancel={cancel} isSaving={isSaving} />
        : <Card key={group.id} className="atez-group-card">
          <div className="atez-group-icon"><TeamOutlined /></div>
          <div className="atez-group-content">
            <div className="atez-group-title"><Typography.Text strong>{group.name}</Typography.Text><Tag color={group.isActive ? 'success' : 'default'}>{group.isActive ? 'Aktif' : 'Pasif'}</Tag></div>
            {group.description && <Typography.Paragraph type="secondary">{group.description}</Typography.Paragraph>}
            <div className="atez-group-emails">{group.emails.map((email) => <Tag key={email}>{email}</Tag>)}</div>
          </div>
          <Space wrap>
            <Switch checked={group.isActive} onChange={() => void toggleActive(group)} aria-label={`${group.name} durumunu değiştir`} />
            <Button icon={<EditOutlined />} aria-label={`${group.name} grubunu düzenle`} onClick={() => startEdit(group)} />
            <Button danger icon={<DeleteOutlined />} aria-label={`${group.name} grubunu sil`} onClick={() => remove(group)} />
          </Space>
        </Card>)}
    </div>
  </div>
}

function GroupForm({ form, setForm, onSave, onCancel, isSaving }: { form: FormState; setForm: (value: FormState) => void; onSave: () => void; onCancel: () => void; isSaving: boolean }) {
  return <Card className="atez-group-form" title={form.name ? 'Grubu düzenle' : 'Yeni dağıtım grubu'}>
    <Form layout="vertical" onFinish={onSave}>
      <Form.Item label="Grup adı" required><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Örn. İthalat Operasyon" /></Form.Item>
      <Form.Item label="Açıklama"><Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Bu grubun kullanım amacı" /></Form.Item>
      <Form.Item label="E-postalar (virgülle ayırın)" required><Input.TextArea rows={3} value={form.emails} onChange={(event) => setForm({ ...form, emails: event.target.value })} placeholder="birinci@sirket.com, ikinci@sirket.com" /></Form.Item>
      <div className="atez-group-form-actions"><Button onClick={onCancel}>Vazgeç</Button><Button type="primary" htmlType="submit" loading={isSaving} disabled={!form.name.trim() || !form.emails.trim()}>Kaydet</Button></div>
    </Form>
  </Card>
}
