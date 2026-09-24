import type { ReactNode } from 'react'
import { Check } from 'lucide-react'

export type ProcessStatus = 'COMPLETED' | 'RUNNING' | 'ATTENTION' | 'FAILED' | 'PENDING'

export function ProcessMarker({ status }: { status: ProcessStatus }) {
  const styles = {
    COMPLETED: 'border-indigo-400 bg-indigo-600 text-white',
    RUNNING: 'border-indigo-400 bg-slate-900 text-indigo-400 ring-4 ring-indigo-500/20',
    ATTENTION: 'border-amber-400 bg-slate-900 text-amber-300',
    FAILED: 'border-rose-400 bg-slate-900 text-rose-300',
    PENDING: 'border-slate-700 bg-slate-800 text-slate-500',
  }
  return (
    <span aria-hidden="true" className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${styles[status]}`}>
      {status === 'COMPLETED' ? <Check className="h-4 w-4" strokeWidth={3} />
        : status === 'ATTENTION' || status === 'FAILED' ? '!'
          : <span className={`h-2 w-2 rounded-full ${status === 'RUNNING' ? 'animate-pulse bg-indigo-400' : 'bg-slate-600'}`} />}
    </span>
  )
}

interface ProcessTimelineProps {
  items: Array<{ id: string; marker: ReactNode; content: ReactNode }>
  progress: number
  columns: 3 | 4 | 5
  stackOnMobile?: boolean
}

/** Shared schedule/operation layout; callers supply their own progress semantics. */
export function ProcessTimeline({ items, progress, columns, stackOnMobile = false }: ProcessTimelineProps) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute top-3 hidden h-[3px] bg-slate-800 lg:block" style={{ left: `${50 / Math.max(items.length, 1)}%`, right: `${50 / Math.max(items.length, 1)}%` }} aria-hidden="true">
        <div data-purpose="process-bar-fill" className="h-full rounded-full bg-indigo-500 shadow-sm shadow-indigo-500/50 transition-[width] duration-700" style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} />
      </div>
      <ol className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${columns === 5 ? 'lg:grid-cols-5' : columns === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {items.map((item) => (
          <li key={item.id} className={stackOnMobile ? 'relative flex min-w-0 flex-col items-center text-center' : 'relative flex min-w-0 items-start gap-3 lg:block'}>
            <div className={stackOnMobile ? 'mb-2 flex shrink-0 justify-center' : 'flex shrink-0 justify-center pt-3 lg:mb-4 lg:pt-0'}>{item.marker}</div>
            {item.content}
          </li>
        ))}
      </ol>
    </div>
  )
}
