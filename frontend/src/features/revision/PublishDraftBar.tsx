import { Alert, Button, Space } from 'antd'
import { Check, Trash2 } from 'lucide-react'

interface Props {
  pendingCount: number
  isBusy: boolean
  isPrompting?: boolean
  conflictVersion: number | null
  /** The revision these changes would become once approved. */
  nextVersion: number
  /** The published revision moved on while this draft was open. */
  staleBehindVersion: number | null
  onPublish: () => void
  onDiscard: () => void
  onReload: () => void
}

export function PublishDraftBar({ pendingCount, isBusy, isPrompting = false, conflictVersion, nextVersion, staleBehindVersion, onPublish, onDiscard, onReload }: Props) {
  // Surfaced as soon as the report moves on, not only when publishing fails: until
  // then the draft quietly hides the newer revision and a reload changes nothing.
  const behind = conflictVersion ?? staleBehindVersion
  if (behind !== null) {
    return <Alert type="warning" showIcon title={`Rapor bu arada r${String(behind).padStart(2, '0')} sürümüne güncellendi.`} description="Şu an eski taslağı görüyorsunuz; değişiklikleriniz güncel sürüme uygulanamaz." action={<Space wrap><Button onClick={onReload} disabled={isBusy || isPrompting}>Yenile</Button><Button type="primary" danger aria-label={`Taslağı bırak, r${String(behind).padStart(2, '0')} sürümünü aç`} onClick={onDiscard} disabled={isBusy || isPrompting}>Taslağı bırak, r{String(behind).padStart(2, '0')} sürümünü aç</Button></Space>} />
  }

  if (pendingCount === 0) return null

  return <Alert type="info" showIcon title="Taslak değişiklikler" description={<p>{pendingCount} değişiklik taslakta birikti. Kaydettiğinizde tümü tek bir r{String(nextVersion).padStart(2, '0')} revizyonuna aktarılır; o zamana kadar yayımlanmış sürüm değişmez.</p>} action={<Space wrap><Button icon={<Trash2 size={14} />} onClick={onDiscard} disabled={isBusy || isPrompting}>Taslağı iptal et</Button><Button type="primary" aria-label={`Kaydet ve r${String(nextVersion).padStart(2, '0')} oluştur`} icon={<Check size={14} />} onClick={onPublish} loading={isBusy} disabled={isBusy || isPrompting}>Kaydet ve r{String(nextVersion).padStart(2, '0')} oluştur</Button></Space>} />
}
