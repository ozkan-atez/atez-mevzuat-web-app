import { useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, LoaderCircle, Trash2 } from 'lucide-react'
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

function runLabel(run: ChatHistoryItem['run']) {
  if (!run) return 'Diğer raporlar'
  const date = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(run.targetDate))
  return `${date} · ${run.id.slice(0, 8)}`
}

export function ConversationHistory({ items, activeId, isLoading, error, onRetry, onDelete, onNavigate }: Props) {
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set())
  const general = items.filter((item) => item.type === 'GENERAL')
  const runs = new Map<string, { run: ChatHistoryItem['run']; items: ChatHistoryItem[] }>()
  for (const item of items) {
    if (item.type !== 'REPORT_REVISION') continue
    const key = item.run?.id ?? 'other'
    const group = runs.get(key)
    if (group) group.items.push(item)
    else runs.set(key, { run: item.run, items: [item] })
  }

  const toggleRun = (key: string) => {
    setOpenRuns((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <nav aria-label="Sohbet geçmişi" className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex items-center justify-between px-2 pt-1">
        <h2 className="text-base font-bold text-slate-900">Konuşmalar</h2>
        {!isLoading && !error && <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{items.length}</span>}
      </div>
      {isLoading && <p className="inline-flex items-center gap-2 px-2 text-xs text-slate-500"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Geçmiş yükleniyor…</p>}
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p>{error}</p>
          <button type="button" onClick={onRetry} className="mt-2 rounded-lg border border-amber-300 px-2.5 py-1 font-semibold hover:bg-amber-100">Yeniden dene</button>
        </div>
      )}
      {!isLoading && !error && items.length === 0 && <p className="px-2 text-xs leading-relaxed text-slate-500">Henüz bir sohbet yok. Asistana bir soru yazarak başlayın.</p>}

      <div className="custom-scroll -mr-1 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {runs.size > 0 && (
          <section aria-label="Rapor sohbetleri">
            <h3 className="px-2 pb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Rapor sohbetleri</h3>
            <div className="space-y-1">
              {[...runs].map(([key, group]) => {
                const isOpen = openRuns.has(key)
                return (
                  <div key={key}>
                    <button type="button" onClick={() => toggleRun(key)} aria-expanded={isOpen} aria-label={`${runLabel(group.run)} taramasının rapor sohbetleri`}
                      className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-[13px] font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                      {isOpen ? <FolderOpen className="h-4 w-4 shrink-0 text-blue-600" /> : <Folder className="h-4 w-4 shrink-0 text-slate-500" />}
                      <span className="min-w-0 flex-1 truncate">{runLabel(group.run)}</span>
                      <span className="text-xs font-medium text-slate-500">{group.items.length}</span>
                      {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      {group.run?.status === 'RUNNING' && <span role="status" aria-label="Tarama çalışıyor"><LoaderCircle aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin text-slate-400 motion-reduce:animate-none" /></span>}
                    </button>
                    {isOpen && (
                      <div className="ml-4 border-l border-slate-200 pl-2">
                        {group.run && <Link to={`/runs/${group.run.id}`} onClick={onNavigate} className="block rounded-lg px-2 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">Taramayı görüntüle</Link>}
                        <ol className="space-y-1">
                          {group.items.map((item) => (
                            <li key={item.id}>
                              <Link to={item.target} onClick={onNavigate} title={item.title} className="block truncate rounded-lg px-2 py-1.5 text-[13px] leading-5 text-slate-600 hover:bg-slate-50 hover:text-slate-900">{item.title}</Link>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {general.length > 0 && (
          <section aria-label="Genel sohbetler">
            <h3 className="px-2 pb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Genel sohbetler</h3>
            <ol className="space-y-1">
              {general.map((item) => (
                <li key={item.id} className="group relative">
                  <Link to={item.target} onClick={onNavigate} aria-current={item.id === activeId ? 'page' : undefined} title={item.title}
                    className={`block truncate rounded-xl px-3 py-2 pr-9 text-[13px] leading-5 font-medium transition ${item.id === activeId ? 'bg-[#eaf0fa] font-semibold text-[#1b2a4a]' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}>
                    {item.title}
                  </Link>
                  <button type="button" aria-label={`${item.title} sohbetini sil`} onClick={() => onDelete(item.id)}
                    className="absolute right-2 top-1.5 rounded-lg p-1.5 text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </nav>
  )
}
