import { useState } from 'react'
import { Alert, Button, Input, Tag, Typography } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { Can } from '../auth/Can'
import { studioApi, StudioRequestError } from '../workspace/studioApi'
import { CATEGORY_LABELS, type ComponentCategory } from '../workspace/studio-types'
import { StudioPreview } from '../workspace/StudioPreview'
import type { ComponentDraftCard } from './types'
import '../workspace/template-studio.css'

/** Taslak kimliğinden türetilen havuz anahtarı: aynı kart ikinci kez kaydedilirse v2 reddeder. */
const draftKey = (id: string) => `ai-${id.replace(/[^a-f0-9]/gi, '').slice(0, 10).toLowerCase()}`

/**
 * Sohbetteki bileşen taslağı kartı: canlı önizleme, doğrulama durumu, ad ve kaydet.
 * Kaydı model değil kullanıcı yapar (v2 API). Mevcut kullanıcı/AI bileşeninin değişikliği yeni sürüm
 * olur; yerleşik bileşenler koddan sürümlendiği için onların değişikliği havuza kopya olarak eklenir.
 */
export function ComponentDraftCardView({ draft }: { draft: ComponentDraftCard }) {
  const [name, setName] = useState(draft.name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  const asVersion = !!draft.target && draft.target.origin !== 'BUILTIN'
  const save = async (activate: boolean) => {
    if (!draft.definition || !name.trim()) return
    setSaving(true)
    setError('')
    try {
      if (asVersion) {
        const c = await studioApi.addComponentVersion(draft.target!.id, { definition: draft.definition, name: name.trim(), description: draft.description, note: 'Sohbetten değiştirildi' })
        setSaved(`“${c.name}” sürüm ${c.currentVersion} olarak kaydedildi.`)
      } else {
        const c = await studioApi.createComponent({ key: draftKey(draft.id), name: name.trim(), description: draft.description, category: draft.category, origin: 'AI', definition: draft.definition, activate })
        setSaved(`“${c.name}” havuza ${activate ? 'eklendi ve aktifleştirildi; şablonlarda seçilebilir.' : 'pasif olarak eklendi.'}`)
      }
    } catch (e) {
      const err = e as StudioRequestError
      if (err.status === 409 && /zaten/.test(err.message)) setSaved('Bu taslak zaten havuza kaydedildi.')
      else setError([err.message, ...(err.issues ?? [])].join(' · '))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="cchat-card" aria-label={`Bileşen taslağı: ${draft.name}`}>
      <div className="cchat-card-head">
        <Input aria-label="Bileşen adı" variant="borderless" value={name} maxLength={120} disabled={!!saved} onChange={(e) => setName(e.target.value)} />
        <Tag>{CATEGORY_LABELS[draft.category as ComponentCategory] ?? draft.category}</Tag>
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
      {draft.target && <Typography.Text type="secondary" className="cchat-card-desc">“{draft.target.name}” bileşeninin değişikliği{asVersion ? '' : ' · yerleşik bileşen olduğu için kopya olarak eklenir'}</Typography.Text>}
      {draft.description && <p className="cchat-card-desc">{draft.description}</p>}
      <StudioPreview html={draft.previewHtml} title={`${draft.name} önizlemesi`} height={280} />
      {!draft.ok && <Alert type="warning" showIcon title="Doğrulama hataları" description={<ul className="studio-issues">{draft.issues.map((i) => <li key={i}>{i}</li>)}</ul>} />}
      {error && <Alert type="error" showIcon title={error} />}
      {saved ? (
        <Alert type="success" showIcon title={saved} action={<Link to="/templates/components">Havuzda gör</Link>} />
      ) : (
        <Can permission="config.manage">
          <div className="cchat-card-actions">
            {asVersion ? (
              <Button type="primary" disabled={!draft.ok || !name.trim()} loading={saving} onClick={() => void save(false)}>
                Yeni sürüm olarak kaydet
              </Button>
            ) : (
              <>
                <Button disabled={!draft.ok || !name.trim()} loading={saving} onClick={() => void save(false)}>
                  Pasif kaydet
                </Button>
                <Button type="primary" disabled={!draft.ok || !name.trim()} loading={saving} onClick={() => void save(true)}>
                  Havuza ekle ve aktifleştir
                </Button>
              </>
            )}
          </div>
        </Can>
      )}
    </div>
  )
}
