import { apiFetch } from '../../lib/apiFetch'
import { useEffect, useState } from 'react'
import { Alert, Button, Collapse, Form, Input, Select, Space, Typography, Upload } from 'antd'
import { DocumentPicker } from '../documents/DocumentPicker'
import { getDocumentContent } from '../documents/api'
import { ReportLayoutDesigner } from './ReportLayoutDesigner'
import { listSources, type WorkspaceSource } from '../workspace/api'
import type { ReportCustomization, ReportDraftView, ReportSourceInput } from './types'

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!)) }
function resolveComponent(html: string, heading: string, spec: Record<string, unknown>): string { return html.replace(/{{\s*(\w+)\s*}}/g, (_, key: string) => escapeHtml(key === 'heading' ? heading : String(key === 'content' ? spec.summary ?? '' : spec[key] ?? ''))) }

const COMPONENTS = [
  { value: 'notice', label: 'Bilgilendirme kutusu', html: '<aside style="padding:16px;background:#eef2ff;border-left:4px solid #6366f1"><h3>Bilgilendirme</h3><p>Açıklamanızı buraya ekleyin.</p></aside>' },
  { value: 'table', label: 'Karşılaştırma tablosu', html: '<table style="width:100%;border-collapse:collapse" border="1"><thead><tr><th>Önceki düzenleme</th><th>Yeni düzenleme</th></tr></thead><tbody><tr><td>Önceki metin</td><td>Yeni metin</td></tr></tbody></table>' },
  { value: 'action', label: 'Aksiyon listesi', html: '<section><h3>Yapılması gerekenler</h3><ul><li>Birinci aksiyon</li><li>İkinci aksiyon</li></ul></section>' },
]
interface Props {
  view: ReportDraftView
  isBusy: boolean
  onApplyTemplate?: (id: string) => Promise<void>
  onSave: (value: ReportCustomization) => Promise<void>
  onAddSource: (value: ReportSourceInput) => Promise<void>
}
export function WorkspaceCustomization({ view, isBusy, onApplyTemplate, onSave, onAddSource }: Props) {
  const [catalog, setCatalog] = useState<{ templates: Array<{ id: string; name: string; html: string; sections: Array<{ id: string; heading: string; html: string; enabled: boolean }> }>; components: Array<{ id: string; heading: string; html: string }> }>({ templates: [], components: [] })
  const [sources, setSources] = useState<WorkspaceSource[]>([])
  const [sourceError, setSourceError] = useState<string | null>(null)
  useEffect(() => { let alive = true; void listSources().then((data) => { if (alive && Array.isArray(data.sources)) setSources(data.sources) }).catch((error: unknown) => { if (alive) setSourceError(error instanceof Error ? error.message : 'Kaynaklar alınamadı') }); return () => { alive = false } }, [])
  const [catalogError, setCatalogError] = useState<string | null>(null)
  useEffect(() => { let alive = true; void apiFetch('/api/v1/templates').then(async (response) => { if (!response.ok) throw new Error('Şablonlar alınamadı'); return response.json() }).then((data) => { if (alive && Array.isArray(data.templates)) setCatalog(data) }).catch((error: unknown) => { if (alive) setCatalogError(error instanceof Error ? error.message : 'Şablonlar alınamadı') }); return () => { alive = false } }, [])
  const stored = view.spec.customization as ReportCustomization | undefined
  const [value, setValue] = useState<ReportCustomization>(stored ?? {})
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sourceForm] = Form.useForm<ReportSourceInput>()
  useEffect(() => { setValue(stored ?? {}) }, [stored])
  const components = catalog.components?.length ? catalog.components.map((item) => ({ value: item.id, label: item.heading, html: item.html })) : COMPONENTS
  return <Collapse className="atez-report-card" items={[
    { key: 'layout', label: 'Başlıklar, düzen ve bileşenler', children: <Space orientation="vertical" style={{ width: '100%' }}>
      {catalogError && <Alert type="warning" title={catalogError} />}
      <Select aria-label="Rapor şablonu" placeholder="Kayıtlı şablon seçin" disabled={isBusy} value={value.templateId ?? undefined} style={{ width: '100%' }} options={catalog.templates.map((template) => ({ value: template.id, label: template.name }))} onChange={(id) => { void (onApplyTemplate ? onApplyTemplate(id) : onSave({ ...value, templateId: id, customHtml: null, sections: [], order: [] })) }} />
      {value.templateId && onApplyTemplate && <Button disabled={isBusy} onClick={() => void onApplyTemplate(value.templateId!)}>Şablonu yeniden uygula</Button>}
      <Typography.Text type="secondary">Başlıkları ve metni sayfanın üzerinde düzenleyin. Bileşenleri sürükleyerek veya yerleştirme düğmeleriyle konumlandırın.</Typography.Text>
      <ReportLayoutDesigner key="visual-designer" view={view} customization={value} disabled={isBusy} onSave={onSave} components={components.map(item => ({ id: item.value, heading: item.label, html: resolveComponent(item.html, item.label, view.spec), enabled: true }))} />
    </Space> },
    { key: 'sources', label: 'Rapora yeni kaynak ekle', children: <>
      <Alert type="info" showIcon title="Kaynağı ekledikten sonra rapora nasıl yansıtılacağını sohbetten isteyebilirsiniz. Kaynakça yayımlanan rapora eklenir." />
      {sourceError && <Alert type="warning" title={sourceError} />}
      <Select aria-label="Kaynak kataloğundan seç" placeholder="Kaynak kataloğundan seçin" style={{ width: '100%', marginTop: 12 }} disabled={isBusy} options={sources.filter((source) => source.isActive).map((source) => ({ value: source.id, label: source.name }))} onChange={(id) => { const source = sources.find((item) => item.id === id)!; sourceForm.setFieldsValue({ label: source.name, url: source.baseUrl, kind: 'URL' }) }} />
      <Button style={{ marginTop: 12 }} disabled={isBusy} onClick={() => setPickerOpen(true)}>Arşivden belge seç / yükle</Button>
      <DocumentPicker open={pickerOpen} onClose={() => setPickerOpen(false)} selected={[]} onSelect={items => { void (async () => { for (const item of items) { const version = await getDocumentContent(item.id); if (!version.text) throw new Error('Belge için okunabilir metin henüz yok. Belgeler sayfasından okuma adımını tamamlayın.'); await onAddSource({ kind: 'FILE', label: item.title, url: '', content: version.text, documentVersionId: item.id }) } })().catch(error => setSourceError(error.message)) }} />
      <Form form={sourceForm} layout="vertical" initialValues={{ kind: 'URL', content: '', url: '' }} disabled={isBusy} onFinish={(source) => { void onAddSource(source).then(() => sourceForm.resetFields()).catch(() => undefined) }}>
        <Form.Item label="Kaynak türü" name="kind"><Select options={[{ value: 'URL', label: 'Web bağlantısı' }, { value: 'TEXT', label: 'Metin' }, { value: 'FILE', label: 'Metin dosyası' }]} /></Form.Item>
        <Form.Item label="Kaynak adı" name="label" rules={[{ required: true, message: 'Kaynak adını girin.' }]}><Input /></Form.Item>
        <Form.Item label="Bağlantı" name="url" dependencies={['kind']} rules={[({ getFieldValue }) => ({ required: getFieldValue('kind') === 'URL', message: 'Web kaynağı için bağlantı girin.' }), { type: 'url', message: 'Geçerli bir bağlantı girin.' }]}><Input placeholder="https://" /></Form.Item>
        <Form.Item label="Kaynak içeriği / alıntı" name="content" rules={[{ required: true, whitespace: true, message: "Kaynağın rapora esas olacak içeriğini girin." }, { max: 100000, message: "Kaynak içeriği en fazla 100.000 karakter olabilir." }]}><Input.TextArea rows={4} /></Form.Item>
        <Form.Item label="Metin dosyası"><Upload accept=".txt,.md,.html" showUploadList={false} beforeUpload={(file) => { if (!/\.(txt|md|html)$/i.test(file.name) || file.size > 1_000_000) { setSourceError('En fazla 1 MB boyutunda .txt, .md veya .html dosyası seçin.'); return false } void file.text().then((content) => { if (content.length > 100000) { setSourceError('Dosya içeriği en fazla 100.000 karakter olabilir.'); return } sourceForm.setFieldsValue({ kind: 'FILE', fileName: file.name, label: file.name, content }); setSourceError(null) }).catch(() => setSourceError('Dosya okunamadı.')); return false }}><Button disabled={isBusy}>Metin dosyası ekle</Button></Upload></Form.Item>
        <Form.Item name="fileName" hidden><Input /></Form.Item>
        <Button type="primary" htmlType="submit" loading={isBusy}>Kaynağı taslağa ekle</Button>
      </Form>
      {(value.sources ?? []).map((source, index) => <Space orientation="vertical" key={source.id} style={{ width: '100%' }}><Input aria-label={`Kaynak ${index + 1} adı`} value={source.label} disabled={isBusy} onChange={(event) => setValue({ ...value, sources: value.sources?.map((item) => item.id === source.id ? { ...item, label: event.target.value } : item) })} /><Input aria-label={`Kaynak ${index + 1} bağlantısı`} value={source.url} disabled={isBusy} onChange={(event) => setValue({ ...value, sources: value.sources?.map((item) => item.id === source.id ? { ...item, url: event.target.value } : item) })} /><Input.TextArea aria-label={`Kaynak ${index + 1} içeriği`} value={source.content} disabled={isBusy} onChange={(event) => setValue({ ...value, sources: value.sources?.map((item) => item.id === source.id ? { ...item, content: event.target.value } : item) })} /><Space><Button disabled={isBusy} onClick={() => void onSave(value)}>Kaynak değişikliklerini uygula</Button><Button disabled={isBusy} danger onClick={() => void onSave({ ...value, sources: value.sources?.filter((item) => item.id !== source.id) })}>Kaynağı kaldır</Button></Space></Space>)}
    </> },
  ]} />
}
