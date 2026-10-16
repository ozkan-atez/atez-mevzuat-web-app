import { Button, Card, Empty } from 'antd'
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
  customization: 'Rapor düzeni ve kaynaklar',
}

export function describeField(path: string): string {
  const [head, ...rest] = path.split('.')
  const base = FIELD_LABELS[head ?? ''] ?? (head ?? path)
  if (rest.length === 0) return base
  if (head === 'customization') return `${base} · ${rest.join('.')}`
  if (head === 'table' && rest[0] === 'rows') return `Tablo · ${Number(rest[1]) + 1}. satır, ${Number(rest[2]) + 1}. sütun`
  if (head === 'table') return `Tablo · ${FIELD_LABELS[`table.${rest[0]}`] ?? rest[0]}`
  if (head === 'timeline') return `Takvim · ${Number(rest[0]) + 1}. satır`
  return `${base} · ${Number(rest[0]) + 1}.`
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '(boş)'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

interface Props {
  edits: ReportFieldEditRecord[]
  onRevert: (editId: string) => void
  isBusy: boolean
  readOnly?: boolean
}

export function ChangeList({ edits, onRevert, isBusy, readOnly = false }: Props) {
  const [openId, setOpenId] = useState<string | null>(null)

  if (edits.length === 0) {
    return (
      <Empty description="Henüz değişiklik yok. Bülten üzerinde bir alana tıklayarak ya da rapor sohbetine yazarak düzenleyebilirsiniz." />
    )
  }

  return (
    <ol className="space-y-1.5">
      {edits.map((edit, index) => {
        const isOpen = openId === edit.id
        const reverted = Boolean(edit.revertedByEditId)
        return (
          <li key={edit.id}>
            <Button block aria-label={describeField(edit.path)} aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : edit.id)} className="atez-change-button">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${reverted ? 'bg-[var(--atez-raised)] text-[var(--atez-muted)]' : 'bg-[var(--atez-accent-soft)] text-[var(--atez-accent)]'}`}>
                {index + 1}
              </span>
              <span className={`min-w-0 flex-1 truncate font-medium ${reverted ? 'text-[var(--atez-muted)] line-through' : 'text-[var(--atez-text)]'}`}>
                {describeField(edit.path)}
              </span>
              {edit.source === 'AI'
                ? <Bot className="h-3.5 w-3.5 shrink-0 text-indigo-500" aria-label="AI" />
                : <User className="h-3.5 w-3.5 shrink-0 text-[var(--atez-muted)]" aria-label="Kullanıcı" />}
            </Button>

            {isOpen && (
              <Card size="small" className="atez-change-detail">
                <p className="text-[var(--atez-muted)]">{edit.actorName ?? 'Kullanıcı bilgisi kaydedilmemiş'} · {new Date(edit.createdAt).toLocaleString('tr-TR')}</p>
                <div>
                  <span className="font-semibold text-[var(--atez-muted)]">Önceki:</span>
                  <p className="mt-0.5 break-words text-[var(--atez-muted)]">{asText(edit.previousValue)}</p>
                </div>
                <div>
                  <span className="font-semibold text-[var(--atez-muted)]">Yeni:</span>
                  <p className="mt-0.5 break-words text-[var(--atez-text)]">{asText(edit.nextValue)}</p>
                </div>
                {edit.prompt && (
                  <div>
                    <span className="font-semibold text-[var(--atez-muted)]">Talep:</span>
                    <p className="mt-0.5 break-words italic text-[var(--atez-muted)]">{edit.prompt}</p>
                  </div>
                )}
                {!readOnly && !reverted && !edit.revertsEditId && edit.revertible && (
                  <Button size="small" icon={<RotateCcw size={12} />} onClick={() => onRevert(edit.id)} disabled={isBusy}>Geri al</Button>
                )}
                {reverted && <p className="text-[11px] font-medium text-[var(--atez-muted)]">Bu değişiklik geri alındı.</p>}
                {!readOnly && !reverted && !edit.revertsEditId && !edit.revertible && (
                  <p className="text-[11px] font-medium text-[var(--atez-muted)]">Bu alan analiz revizyonundan geldi; tek tek geri alınamaz. Taslağı iptal ederek tümünü bırakabilirsiniz.</p>
                )}
              </Card>
            )}
          </li>
        )
      })}
    </ol>
  )
}
