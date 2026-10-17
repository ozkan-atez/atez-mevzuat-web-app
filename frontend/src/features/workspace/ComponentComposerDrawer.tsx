import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Drawer, Empty, Form, Input, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import { ArrowUpOutlined, CheckCircleOutlined, CloseCircleOutlined, RobotOutlined } from '@ant-design/icons'
import { studioApi, StudioRequestError } from './studioApi'
import { CATEGORY_LABELS, type ComponentDraft } from './studio-types'
import { StudioPreview } from './StudioPreview'

type Turn = { role: 'user' | 'assistant'; content: string; error?: boolean }
const STARTERS = [
  'Yürürlük tarihini öne çıkaran, altında kısa açıklama olan bir kart',
  'Değişen GTİP’leri yalnızca önceki / yeni / değişim sütunlarıyla gösteren sade tablo',
  'Firmaların yapması gerekenleri madde madde listeleyen eylem kutusu',
]

/**
 * AI ile bileşen oluşturma paneli (§10.1-4): sohbet, taslak önizlemesi, kaydet. Takip istekleri
 * ("tabloyu sadeleştir") son taslağı temel alır. Kayıt yalnızca kullanıcının butonuyla yapılır.
 */
export function ComponentComposerDrawer({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState<ComponentDraft | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedText, setSavedText] = useState('')
  const [form] = Form.useForm<{ name: string; description: string }>()
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => end.current?.scrollIntoView?.({ block: 'nearest' }), [turns.length, busy])

  const send = async () => {
    const request = input.trim()
    if (!request || busy) return
    setBusy(true)
    setInput('')
    setTurns((t) => [...t, { role: 'user', content: request }])
    try {
      const d = await studioApi.draftComponent({
        request,
        base: draft?.definition ? { name: draft.name, description: draft.description, category: draft.category, definition: draft.definition } : null,
        conversation: turns.filter((t) => !t.error).slice(-12),
      })
      setDraft(d)
      setSavedText('')
      form.setFieldsValue({ name: d.name, description: d.description })
      setTurns((t) => [...t, { role: 'assistant', content: d.ok ? `“${d.name}” taslağı hazır${d.repairRounds ? ' (bir onarım turuyla doğrulandı)' : ''}. Önizleyin, mesajla geliştirin ya da kaydedin.` : 'Taslak doğrulamadan geçmedi; ayrıntılar önizlemenin altında.' }])
    } catch (e) {
      setTurns((t) => [...t, { role: 'assistant', content: (e as Error).message, error: true }])
      setInput((v) => v || request)
    } finally {
      setBusy(false)
    }
  }
  const save = async (activate: boolean) => {
    if (!draft?.definition) return
    const values = await form.validateFields()
    setSaving(true)
    try {
      const c = await studioApi.createComponent({ name: values.name, description: values.description ?? '', category: draft.category, origin: 'AI', definition: draft.definition, activate })
      setSavedText(`“${c.name}” ${activate ? 'kaydedildi ve aktifleştirildi' : 'pasif olarak kaydedildi'}.`)
      onSaved()
    } catch (e) {
      const err = e as StudioRequestError
      setTurns((t) => [...t, { role: 'assistant', content: [err.message, ...(err.issues ?? [])].join(' · '), error: true }])
    } finally {
      setSaving(false)
    }
  }
  const reset = () => {
    setTurns([])
    setDraft(null)
    setSavedText('')
    form.resetFields()
  }

  return (
    <Drawer
      title={
        <Space>
          <RobotOutlined aria-hidden="true" /> AI ile yeni bileşen
        </Space>
      }
      open={open}
      onClose={onClose}
      size="min(1080px, 100vw)"
      destroyOnHidden={false}
      extra={
        <Button onClick={reset} disabled={!turns.length || busy}>
          Yeni sohbet
        </Button>
      }
      className="component-composer-drawer"
    >
      <div className="component-composer">
        <section className="component-chat composer-chat" aria-label="Bileşen sohbeti">
          <div className="component-chat-messages" role="log" aria-live="polite">
            {!turns.length && (
              <div className="component-chat-welcome">
                <div className="component-assistant-icon">
                  <RobotOutlined aria-hidden="true" />
                </div>
                <Typography.Title level={5}>Birlikte yeni bir parça tasarlayalım</Typography.Title>
                <Typography.Paragraph type="secondary">AI yalnızca izinli parçalar, tema sınıfları ve analizdeki veri bağlarıyla bir taslak üretir. Sayılar ve tablolar analizden kodla gelir.</Typography.Paragraph>
                <Space orientation="vertical" style={{ width: '100%' }}>
                  {STARTERS.map((s) => (
                    <Button key={s} className="component-chat-starter" block onClick={() => setInput(s)}>
                      {s}
                    </Button>
                  ))}
                </Space>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`component-chat-message ${t.role}`}>
                <div className="component-chat-speaker">{t.role === 'user' ? 'Siz' : 'Bileşen asistanı'}</div>
                {t.error ? <Alert type="error" title={t.content} /> : <p>{t.content}</p>}
              </div>
            ))}
            {busy && (
              <div className="component-chat-thinking" role="status">
                <Spin size="small" /> Taslak hazırlanıyor…
              </div>
            )}
            <div ref={end} />
          </div>
          <div className="component-chat-composer">
            <Input.TextArea
              aria-label="Bileşen isteği"
              autoSize={{ minRows: 3, maxRows: 6 }}
              value={input}
              maxLength={2000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder={draft ? 'Düzeltme isteyin: “başlığa rozet ekle”, “tabloyu sadeleştir”…' : 'Ne tür bir bileşen istiyorsunuz?'}
            />
            <div className="component-chat-send">
              <Typography.Text type="secondary">Ctrl/⌘ + Enter ile gönderin. Taslak siz kaydedene kadar havuza alınmaz.</Typography.Text>
              <Button type="primary" icon={<ArrowUpOutlined aria-hidden="true" />} loading={busy} disabled={!input.trim()} onClick={() => void send()}>
                {draft ? 'Düzelt' : 'Oluştur'}
              </Button>
            </div>
          </div>
        </section>
        <section className="composer-preview" aria-label="Taslak önizlemesi">
          <div className="composer-preview-head">
            <Typography.Text strong>Taslak önizleme</Typography.Text>
            {draft &&
              (draft.ok ? (
                <Tag color="success" icon={<CheckCircleOutlined />}>
                  Doğrulandı
                </Tag>
              ) : (
                <Tag color="error" icon={<CloseCircleOutlined />}>
                  Doğrulama hatası
                </Tag>
              ))}
          </div>
          {draft ? <StudioPreview html={draft.previewHtml} title="Taslak önizlemesi" height={360} /> : <Empty className="composer-empty" description="Taslak burada canlı olarak görünecek." />}
          {draft && !draft.ok && <Alert type="warning" showIcon title="Doğrulama hataları" description={<ul className="studio-issues">{draft.issues.map((i) => <li key={i}>{i}</li>)}</ul>} />}
          {draft && (
            <Form form={form} layout="vertical" className="composer-form" requiredMark={false}>
              <Form.Item name="name" label="Ad" rules={[{ required: true, message: 'Ad gerekli' }]}>
                <Input maxLength={120} />
              </Form.Item>
              <Form.Item name="description" label="Açıklama" tooltip="Bileşenin hangi analizlerde kullanılacağını yazın; şablon ve AI bu açıklamayı görür.">
                <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={1000} />
              </Form.Item>
              <div className="composer-meta">
                <Tag>{CATEGORY_LABELS[draft.category]}</Tag>
                <Tooltip title="Görünme kuralı (CEL)">
                  <code>{draft.definition?.appliesWhen || 'her zaman görünür'}</code>
                </Tooltip>
                {draft.definition?.bindings.map((b) => (
                  <Tag key={b} bordered={false} className="binding-tag">
                    {b}
                  </Tag>
                ))}
              </div>
              <Space className="composer-actions">
                <Button disabled={!draft.ok} loading={saving} onClick={() => void save(false)}>
                  Kaydet (pasif)
                </Button>
                <Button type="primary" disabled={!draft.ok} loading={saving} onClick={() => void save(true)}>
                  Kaydet ve aktifleştir
                </Button>
              </Space>
              {savedText && <Alert type="success" showIcon title={savedText} />}
            </Form>
          )}
        </section>
      </div>
    </Drawer>
  )
}
