import { FileText, LoaderCircle, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ChatHistoryItem } from './types'

interface Props {
  items: ChatHistoryItem[]
  activeId: string | undefined
  isLoading: boolean
  error: string | null
  onRetry: () => void
  onDelete: (id: string) => void
  onNavigate?: () => void
}

export function ConversationHistory({ items, activeId, isLoading, error, onRetry, onDelete, onNavigate }: Props) {
  return (
    <nav aria-label="Sohbet geçmişi" className="flex h-full min-h-0 flex-col gap-3 p-3">
      <Link
        to="/chat"
        onClick={onNavigate}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700/70 bg-slate-800/60 px-3 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-blue-400/50 hover:bg-slate-700/70"
      >
        <Plus className="h-4 w-4" />Yeni sohbet
      </Link>

      {isLoading && (
        <p className="inline-flex items-center gap-2 px-2 text-xs text-slate-400">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />Geçmiş yükleniyor…
        </p>
      )}

      {error && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <p>{error}</p>
          <button type="button" onClick={onRetry} className="mt-2 rounded-lg border border-amber-400/40 px-2.5 py-1 font-semibold hover:bg-amber-500/20">
            Yeniden dene
          </button>
        </div>
      )}

      {!isLoading && !error && items.length === 0 && (
        <p className="px-2 text-xs leading-relaxed text-slate-400">
          Henüz bir sohbet yok. Aşağıdan bir soru yazarak başlayın.
        </p>
      )}

      <ol className="custom-scroll -mr-1 flex-1 space-y-1 overflow-y-auto pr-1">
        {items.map((item) => {
          const isActive = item.id === activeId
          return (
            <li key={item.id} className="group relative">
              <Link
                to={item.target}
                onClick={onNavigate}
                aria-current={isActive ? 'page' : undefined}
                className={`block rounded-xl border px-3 py-2.5 pr-9 transition ${
                  isActive
                    ? 'border-blue-400/50 bg-blue-500/15 text-white'
                    : 'border-transparent text-slate-300 hover:border-slate-700/70 hover:bg-slate-800/60'
                }`}
              >
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {item.type === 'GENERAL'
                    ? <><MessageSquare className="h-3 w-3" />Sohbet</>
                    : <><FileText className="h-3 w-3" />Rapor revizyonu</>}
                </span>
                <span className="mt-1 block truncate text-sm font-medium">{item.title}</span>
                {item.preview && <span className="mt-0.5 block truncate text-xs text-slate-400">{item.preview}</span>}
              </Link>

              {/* Only a general conversation is the user's to delete; a revision
                  thread is part of its report's history. */}
              {item.type === 'GENERAL' && (
                <button
                  type="button"
                  aria-label={`${item.title} sohbetini sil`}
                  onClick={() => onDelete(item.id)}
                  className="absolute right-2 top-2.5 rounded-lg p-1.5 text-slate-500 opacity-0 transition hover:bg-slate-700/70 hover:text-rose-300 focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
