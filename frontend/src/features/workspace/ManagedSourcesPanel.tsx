import { Can } from '../auth/Can'
import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Checkbox, Descriptions, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { workspaceRequest } from './api'
import { listChatHistory } from '../chat/api'
import type { ChatHistoryItem } from '../chat/types'
import { addReportSource } from '../revision/api'

export interface ManagedSource {
  id: string; title: string; url: string; description: string | null; keywords: string | null
  contentText: string | null; fetchedAt: string | null; fetchError: string | null; contentType: string | null
  useInChat: boolean; useInRuns: boolean; isActive: boolean
}
function errorText(error: unknown) { return error instanceof Error ? error.message : 'İşlem tamamlanamadı.' }
export function ReportSourceImport({ source, onClose }: { source: { title: string; url: string; contentText: string | null }; onClose: () => void }) {
  const navigate = useNavigate()
  const [reports, setReports] = useState<ChatHistoryItem[]>([])
  const [topicId, setTopicId] = useState<string>()
  const [content, setContent] = useState((source.contentText ?? '').slice(0, 100000))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { let alive = true; void listChatHistory().then((history) => { if (alive) setReports(history.filter((item) => item.type === 'REPORT_REVISION')) }).catch((caught: unknown) => { if (alive) setError(errorText(caught)) }); return () => { alive = false } }, [])
  const importSource = async () => {
    if (!topicId || !content.trim()) return
    setBusy(true); setError(null)
    try { await addReportSource(topicId, { label: source.title, url: source.url, content, kind: 'URL' }); navigate(`/chat?topic=${encodeURIComponent(topicId)}`); onClose() }
    catch (caught) { setError(errorText(caught)) }
    finally { setBusy(false) }
  }
  const topicFrom = (target: string) => target.startsWith('/reports/') ? target.slice('/reports/'.length).split('?')[0]! : new URLSearchParams(target.split('?')[1] ?? '').get('topic') ?? ''
  return <Modal title="Kaynağı rapora ekle" open onCancel={onClose} onOk={() => void importSource()} okText="Taslağa ekle ve raporu aç" confirmLoading={busy} okButtonProps={{ disabled: !topicId || !content.trim() || content.length > 100000 }}>
    {error && <Alert type="error" title={error} />}
    <Form layout="vertical"><Form.Item label="Hedef rapor"><Select aria-label="Hedef rapor" placeholder="Rapor seçin" value={topicId} onChange={setTopicId} options={reports.map((report) => ({ value: topicFrom(report.target), label: report.title })).filter((report) => report.value)} /></Form.Item>
    <Form.Item label="Kaynak içeriği"><Input.TextArea aria-label="Rapora eklenecek kaynak içeriği" rows={8} value={content} maxLength={100000} onChange={(event) => setContent(event.target.value)} /></Form.Item></Form>
    <Typography.Text type="secondary">İçerik raporun kaynakçasına ve AI düzenleme bağlamına eklenir. Rapora yansıtılacak değişikliği açılan sohbetten isteyin.</Typography.Text>
  </Modal>
}
export function ManagedSourcesPanel() {
  const [sources, setSources] = useState<ManagedSource[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ManagedSource | 'new' | null>(null)
  const [preview, setPreview] = useState<ManagedSource | null>(null)
  const [importing, setImporting] = useState<ManagedSource | null>(null)
  const [form] = Form.useForm()
  const load = useCallback(async () => { setLoading(true); try { const data = await workspaceRequest<{ sources: ManagedSource[] }>('managed-sources'); setSources(data.sources); setError(null) } catch (caught) { setError(errorText(caught)) } finally { setLoading(false) } }, [])
  useEffect(() => { void load() }, [load])
  const openEditor = (source: ManagedSource | 'new') => { setEditing(source); form.resetFields(); form.setFieldsValue(source === 'new' ? { useInChat: true, useInRuns: true, isActive: true } : source) }
  const save = async () => {
    let values: Record<string, unknown>
    try { values = await form.validateFields() } catch { return }
    setBusyId('editor'); setError(null)
    try { await workspaceRequest(editing === 'new' ? 'managed-sources' : `managed-sources/${(editing as ManagedSource).id}`, { method: editing === 'new' ? 'POST' : 'PUT', body: JSON.stringify({ ...values, description: values.description || null, keywords: values.keywords || null }) }); setEditing(null); await load() }
    catch (caught) { setError(errorText(caught)) } finally { setBusyId(null) }
  }
  const action = async (source: ManagedSource, operation: 'refresh' | 'disable') => { setBusyId(source.id); setError(null); try { await workspaceRequest(`managed-sources/${source.id}${operation === 'refresh' ? '/refresh' : ''}`, { method: operation === 'refresh' ? 'POST' : 'DELETE' }); await load() } catch (caught) { setError(errorText(caught)) } finally { setBusyId(null) } }
  return <Card title="Ek kaynaklar ve içerik arşivi" extra={<Space><Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>Yenile</Button><Can permission="config.manage"><Button type="primary" aria-label="Kaynak ekle" icon={<PlusOutlined />} onClick={() => openEditor('new')}>Kaynak ekle</Button></Can></Space>}>
    {error && <Alert type="error" title={error} showIcon style={{ marginBottom: 12 }} />}
    <Table rowKey="id" loading={loading} dataSource={sources} scroll={{ x: 900 }} pagination={{ pageSize: 8 }} columns={[
      { title: 'Kaynak', key: 'source', render: (_, source) => <Space orientation="vertical"><Typography.Text strong>{source.title}</Typography.Text><a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>{source.fetchError && <Tag color="error">{source.fetchError}</Tag>}</Space> },
      { title: 'Kullanım', key: 'usage', render: (_, source) => <Space wrap>{source.isActive ? <Tag color="success">Aktif</Tag> : <Tag>Pasif</Tag>}{source.useInChat && <Tag>Sohbet</Tag>}{source.useInRuns && <Tag>Tarama</Tag>}</Space> },
      { title: 'Son okuma', dataIndex: 'fetchedAt', render: (value: string | null) => value ? new Date(value).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : 'Henüz okunmadı' },
      { title: 'İşlemler', key: 'actions', render: (_, source) => <Space wrap><Can permission="config.manage"><Button size="small" onClick={() => openEditor(source)}>Düzenle</Button></Can><Button size="small" onClick={() => setPreview(source)}>İçerik</Button><Can permission="config.manage"><Button size="small" loading={busyId === source.id} onClick={() => void action(source, 'refresh')}>İçeriği yenile</Button></Can><Can permission="report.edit"><Button size="small" disabled={!source.contentText} onClick={() => setImporting(source)}>Rapora ekle</Button></Can><Can permission="config.manage"><Button size="small" danger disabled={!source.isActive || busyId === source.id} onClick={() => void action(source, 'disable')}>Devre dışı bırak</Button></Can></Space> },
    ]} />
    <Modal title={editing === 'new' ? 'Kaynak ekle' : 'Kaynağı düzenle'} open={editing !== null} onCancel={() => setEditing(null)} onOk={() => void save()} confirmLoading={busyId === 'editor'} okText="Kaydet">
      {error && <Alert type="error" title={error} />}
      <Form form={form} layout="vertical"><Form.Item name="title" label="Kaynak adı" rules={[{ required: true, message: 'Kaynak adı gereklidir.' }]}><Input /></Form.Item><Form.Item name="url" label="Kaynak bağlantısı" rules={[{ required: true, type: 'url', message: 'Geçerli bir kaynak bağlantısı girin.' }]}><Input /></Form.Item><Form.Item name="description" label="Açıklama"><Input.TextArea rows={2} /></Form.Item><Form.Item name="keywords" label="Anahtar kelimeler"><Input /></Form.Item><Space wrap><Form.Item name="useInChat" valuePropName="checked"><Checkbox>Sohbette kullan</Checkbox></Form.Item><Form.Item name="useInRuns" valuePropName="checked"><Checkbox>Taramalarda kullan</Checkbox></Form.Item><Form.Item name="isActive" valuePropName="checked"><Checkbox>Aktif</Checkbox></Form.Item></Space></Form>
    </Modal>
    <Modal title={preview?.title} open={preview !== null} onCancel={() => setPreview(null)} footer={<Button onClick={() => setPreview(null)}>Kapat</Button>} width={800}>
      <Descriptions items={[{ key: 'type', label: 'İçerik türü', children: preview?.contentType ?? 'Bilinmiyor' }]} />{preview?.fetchError && <Alert type="warning" title={preview.fetchError} />}<Input.TextArea aria-label="Kaynakta okunan içerik" readOnly rows={15} value={preview?.contentText ?? ''} />
    </Modal>
    {importing && <ReportSourceImport source={importing} onClose={() => setImporting(null)} />}
  </Card>
}
