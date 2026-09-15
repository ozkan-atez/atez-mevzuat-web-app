import { useState } from 'react'
import { Bot, RotateCcw, User } from 'lucide-react'
import type { ReportFieldEditRecord } from './types'

const FIELD_LABELS: Record<string, string> = {
  title: 'Başlık',
  typeLabel: 'Tür etiketi',
  summary: 'Kısa özet',
  documentNumber: 'Belge numarası',
  note: 'Not',
  affectedParties: 'Etkilenen taraflar',
  dates: 'Tarihler',
  oldDeadline: 'Önceki son tarih',
  newDeadline: 'Yeni son tarih',
  timeline: 'Takvim',
  removedRule: 'Kaldırılan düzenleme',
  replacementRule: 'Yerine gelen düzenleme',
  alert: 'Kritik uyarı',
  supportingSource: 'Destekleyici kaynak',
  emptyDayText: 'Bilgi metni',
  table: 'Tablo',
}

export function describeField(path: string): string {
  const [head, ...rest] = path.split('.')
  const base = FIELD_LABELS[head ?? ''] ?? (head ?? path)
  if (rest.length === 0) return base
  if (head === 'table' && rest[0] === 'rows') return `Tablo · ${Number(rest[1]) + 1}. satır, ${Number(rest[2]) + 1}. sütun`
  if (head === 'table') return `Tablo · ${FIELD_LABELS[`table.${rest[0]}`] ?? rest[0]}`
  if (head === 'timeline') return `Takvim · ${Number(rest[0]) + 1}. satır`
  return `${base} · ${Number(rest[0]) + 1}.`
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '(boş)'
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

interface Props {
  edits: ReportFieldEditRecord[]
  onRevert: (editId: string) => void
  isBusy: boolean
}

export function ChangeList({ edits, onRevert, isBusy }: Props) {
  const [openId, setOpenId] = useState<string | null>(null)

  if (edits.length === 0) {
    return (
      <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
        Henüz değişiklik yok. Bülten üzerinde bir alana tıklayarak ya da alttaki asistana yazarak düzenleyebilirsiniz.
      </p>
    )
  }

  return (
    <ol className="space-y-1.5">
      {edits.map((edit, index) => {
        const isOpen = openId === edit.id
        const reverted = Boolean(edit.revertedByEditId)
        return (
          <li key={edit.id}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenId(isOpen ? null : edit.id)}
              className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-xs transition-colors ${isOpen ? 'border-blue-300 bg-blue-50/60' : 'border-slate-200 hover:bg-slate-50'}`}
            >
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${reverted ? 'bg-slate-200 text-slate-500' : 'bg-slate-900 text-white'}`}>
                {index + 1}
              </span>
              <span className={`min-w-0 flex-1 truncate font-medium ${reverted ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                {describeField(edit.path)}
              </span>
              {edit.source === 'AI'
                ? <Bot className="h-3.5 w-3.5 shrink-0 text-indigo-500" aria-label="AI" />
                : <User className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-label="Kullanıcı" />}
            </button>

            {isOpen && (
              <div className="mt-1 space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs">
                <div>
                  <span className="font-semibold text-slate-500">Önceki:</span>
                  <p className="mt-0.5 break-words text-slate-600">{asText(edit.previousValue)}</p>
                </div>
                <div>
                  <span className="font-semibold text-slate-500">Yeni:</span>
                  <p className="mt-0.5 break-words text-slate-900">{asText(edit.nextValue)}</p>
                </div>
                {edit.prompt && (
                  <div>
                    <span className="font-semibold text-slate-500">Talep:</span>
                    <p className="mt-0.5 break-words italic text-slate-600">{edit.prompt}</p>
                  </div>
                )}
                {!reverted && !edit.revertsEditId && edit.revertible && (
                  <button
                    type="button"
                    onClick={() => onRevert(edit.id)}
                    disabled={isBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" />Geri al
                  </button>
                )}
                {reverted && <p className="text-[11px] font-medium text-slate-400">Bu değişiklik geri alındı.</p>}
                {!reverted && !edit.revertsEditId && !edit.revertible && (
                  <p className="text-[11px] font-medium text-slate-400">Bu alan analiz revizyonundan geldi; tek tek geri alınamaz. Taslağı iptal ederek tümünü bırakabilirsiniz.</p>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
