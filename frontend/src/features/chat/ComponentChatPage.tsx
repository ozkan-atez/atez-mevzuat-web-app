import { useEffect, useRef, useState } from 'react'
import { Alert, Avatar, Button, Input, Tag, Typography } from 'antd'
import { AppstoreOutlined, ArrowUpOutlined, CheckCircleOutlined, CloseCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { studioApi, StudioRequestError } from '../workspace/studioApi'
import { CATEGORY_LABELS, type ComponentDraft } from '../workspace/studio-types'
import { StudioPreview } from '../workspace/StudioPreview'
import './chat-workspace.css'
import '../workspace/template-studio.css'

type Turn =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; draft?: ComponentDraft; error?: boolean }

const STARTERS = [
  'Yürürlük tarihini öne çıkaran, altında kısa açıklama olan bir kart',
  'Değişen GTİP’leri yalnızca önceki / yeni / değişim sütunlarıyla gösteren sade tablo',
  'Firmaların yapması gerekenleri son tarihleriyle listeleyen eylem kutusu',
  'Gümrük müşaviri için “beyannamede neye dikkat” notu',
]

/**
 * Sohbetten bileşen oluşturma (§10.1-4/5): asistan tasarım dilimizi ve yerleşik bileşen örneklerini
 * bilerek taslak üretir; taslak aksiyon kartında önizlenir, kayıt yalnızca kullanıcının butonuyla olur.
 * Takip mesajları son taslağı temel alır.
 */
export function ComponentChatPage() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => end.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' }), [turns.length, busy])
  const latest = [...turns].reverse().find((t): t is Extract<Turn, { role: 'assistant' }> & { draft: ComponentDraft } => t.role === 'assistant' && !!t.draft)?.draft

  const send = async (text = input) => {
    const request = text.trim()
    if (request.length < 3 || busy) return
    setBusy(true)
    setInput('')
    const history = turns.filter((t) => !(t.role === 'assistant' && t.error)).map((t) => ({ role: t.role, content: t.content })).slice(-12)
    setTurns((t) => [...t, { role: 'user', content: request }])
    try {
      const d = await studioApi.draftComponent({
        request,
        base: latest?.definition ? { name: latest.name, description: latest.description, category: latest.category, definition: latest.definition } : null,
        conversation: history,
      })
      const content = d.reply?.trim() || (d.ok ? `“${d.name}” taslağı hazır. Önizleyin, mesajla geliştirin ya da havuza kaydedin.` : 'Taslak doğrulamadan geçmedi; ayrıntılar kartta.')
      setTurns((t) => [...t, { role: 'assistant', content, draft: d }])
    } catch (e) {
      setTurns((t) => [...t, { role: 'assistant', content: (e as Error).message, error: true }])
      setInput((v) => v || request)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="atez-demo-page">
      <div className="atez-chat-workspace">
        <main className="atez-chat-main">
          <header className="atez-chat-header">
            <Avatar className="atez-chat-header-avatar" icon={<AppstoreOutlined />} />
            <div>
              <Typography.Text strong>Bileşen asistanı</Typography.Text>
              <Typography.Text type="secondary" className="atez-chat-header-subtitle">
                Rapor bileşenini tarif edin; tasarım dilimize uygun taslağı hazırlar, siz onaylayınca havuza eklenir.
              </Typography.Text>
            </div>
            <div className="cchat-header-actions">
              <Link to="/templates/components">Bileşen havuzu</Link>
              <Button icon={<PlusOutlined />} disabled={!turns.length || busy} onClick={() => setTurns([])}>
                Yeni sohbet
              </Button>
            </div>
          </header>
          <div className="atez-chat-scroll">
            {!turns.length ? (
              <div className="atez-chat-empty">
                <div className="atez-chat-orb" />
                <span className="atez-chat-eyebrow">YENİ BİLEŞEN</span>
                <Typography.Title level={2}>Rapora nasıl bir parça ekleyelim?</Typography.Title>
                <p>Ne göstermek istediğinizi anlatın. Asistan yerleşik bileşenlerimizi örnek alır, yalnızca izinli parçalar ve analizdeki verilerle çalışır; sayılar ve tablolar analizden kodla gelir.</p>
                <div className="cchat-starters">
                  {STARTERS.map((s) => (
                    <button key={s} type="button" onClick={() => void send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="atez-chat-messages" role="log" aria-live="polite">
                {turns.map((t, i) => (
                  <div key={i} className={`atez-chat-message ${t.role}`}>
                    {t.role === 'assistant' && <span className="atez-chat-orb atez-chat-message-orb" aria-hidden="true" />}
                    <div className="atez-chat-message-body">
                      {t.role === 'assistant' && t.error ? <Alert type="error" showIcon title={t.content} /> : <p className="cchat-text">{t.content}</p>}
                      {t.role === 'assistant' && t.draft && <DraftCard draft={t.draft} current={t.draft === latest} />}
                    </div>
                  </div>
                ))}
                {busy && (
                  <div className="atez-chat-message assistant" role="status">
                    <span className="atez-chat-orb atez-chat-message-orb" aria-hidden="true" />
                    <div className="atez-chat-message-body cchat-thinking">Taslak hazırlanıyor<span className="atez-chat-cursor" /></div>
                  </div>
                )}
                <div ref={end} />
              </div>
            )}
          </div>
          <div className="atez-chat-composer">
            <div className="atez-chat-composer-box">
              <Input.TextArea
                variant="borderless"
                aria-label="Bileşen isteği"
                autoSize={{ minRows: 2, maxRows: 8 }}
                maxLength={2000}
                value={input}
                placeholder={latest ? 'Düzeltme isteyin: “başlığa rozet ekle”, “tabloyu sadeleştir”…' : 'Nasıl bir bileşen istiyorsunuz?'}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              <div className="cchat-send">
                <Typography.Text type="secondary">Enter ile gönderin · Shift+Enter yeni satır</Typography.Text>
                <Button className="atez-chat-send" type="primary" shape="circle" aria-label="Gönder" icon={<ArrowUpOutlined />} loading={busy} disabled={input.trim().length < 3} onClick={() => void send()} />
              </div>
            </div>
            <Typography.Text type="secondary" className="atez-chat-composer-note">
              Taslaklar siz kaydedene kadar havuza alınmaz. Bu sohbet sayfa kapanınca saklanmaz.
            </Typography.Text>
          </div>
        </main>
      </div>
    </div>
  )
}

/** Aksiyon kartı: canlı önizleme, doğrulama durumu, ad, kaydet / aktifleştir. */
function DraftCard({ draft, current }: { draft: ComponentDraft; current: boolean }) {
  const [name, setName] = useState(draft.name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<{ text: string } | null>(null)
  const [error, setError] = useState('')
  const save = async (activate: boolean) => {
    if (!draft.definition || !name.trim()) return
    setSaving(true)
    setError('')
    try {
      const c = await studioApi.createComponent({ name: name.trim(), description: draft.description, category: draft.category, origin: 'AI', definition: draft.definition, activate })
      setSaved({ text: `“${c.name}” havuza ${activate ? 'eklendi ve aktifleştirildi; şablonlarda seçilebilir.' : 'pasif olarak eklendi.'}` })
    } catch (e) {
      const err = e as StudioRequestError
      setError([err.message, ...(err.issues ?? [])].join(' · '))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className={`cchat-card ${current ? '' : 'is-old'}`}>
      <div className="cchat-card-head">
        <Input aria-label="Bileşen adı" variant="borderless" value={name} maxLength={120} disabled={!!saved} onChange={(e) => setName(e.target.value)} />
        <Tag>{CATEGORY_LABELS[draft.category]}</Tag>
        {draft.ok ? (
          <Tag color="success" icon={<CheckCircleOutlined />}>
            Doğrulandı
          </Tag>
        ) : (
          <Tag color="error" icon={<CloseCircleOutlined />}>
            Doğrulama hatası
          </Tag>
        )}
      </div>
      {draft.description && <p className="cchat-card-desc">{draft.description}</p>}
      <StudioPreview html={draft.previewHtml} title={`${draft.name} önizlemesi`} height={300} />
      {!draft.ok && <Alert type="warning" showIcon title="Doğrulama hataları" description={<ul className="studio-issues">{draft.issues.map((i) => <li key={i}>{i}</li>)}</ul>} />}
      {error && <Alert type="error" showIcon title={error} />}
      {saved ? (
        <Alert
          type="success"
          showIcon
          title={saved.text}
          action={
            <Link to="/templates/components">Havuzda gör</Link>
          }
        />
      ) : (
        <div className="cchat-card-actions">
          {!current && <Typography.Text type="secondary">Önceki taslak</Typography.Text>}
          <Button disabled={!draft.ok || !name.trim()} loading={saving} onClick={() => void save(false)}>
            Pasif kaydet
          </Button>
          <Button type="primary" disabled={!draft.ok || !name.trim()} loading={saving} onClick={() => void save(true)}>
            Havuza ekle ve aktifleştir
          </Button>
        </div>
      )}
    </div>
  )
}
