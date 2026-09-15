import { AlertTriangle, Check, LoaderCircle, Trash2 } from 'lucide-react'

interface Props {
  pendingCount: number
  isBusy: boolean
  conflictVersion: number | null
  onPublish: () => void
  onDiscard: () => void
  onReload: () => void
}

export function PublishDraftBar({ pendingCount, isBusy, conflictVersion, onPublish, onDiscard, onReload }: Props) {
  if (conflictVersion !== null) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
        <p className="flex items-center gap-2 text-xs font-medium text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Rapor bu arada r{String(conflictVersion).padStart(2, '0')} sürümüne güncellendi. Değişiklikleriniz güncel sürüme uygulanmadı.
        </p>
        <button type="button" onClick={onReload} className="rounded-xl bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white">
          Güncel sürümü yükle
        </button>
      </div>
    )
  }

  if (pendingCount === 0) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 px-4 py-3">
      <p className="text-xs font-medium text-blue-900">
        <strong>{pendingCount}</strong> değişiklik yayımlanmayı bekliyor. Yayımlayınca tek bir yeni revizyon oluşur.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDiscard}
          disabled={isBusy}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />Taslağı iptal et
        </button>
        <button
          type="button"
          onClick={onPublish}
          disabled={isBusy}
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
        >
          {isBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Revizyonu yayımla
        </button>
      </div>
    </div>
  )
}
