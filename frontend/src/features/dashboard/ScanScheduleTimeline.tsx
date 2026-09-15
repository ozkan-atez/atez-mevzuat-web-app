import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ScheduleSlot, ScheduleView } from '../scans/types'

const STAGE_LABELS: Record<string, string> = {
  DISCOVERING: 'Kaynaklar keşfediliyor',
  AI_FILTERING: 'Belgeler filtreleniyor',
  DOWNLOADING_DOCUMENTS: 'Belgeler indiriliyor',
  DISCOVERING_ASSETS: 'Ekler keşfediliyor',
  DOWNLOADING_ASSETS: 'Ekler indiriliyor',
  VALIDATING: 'Doğrulanıyor',
  DISCOVERING_PREVIOUS_SOURCES: 'Önceki kaynaklar aranıyor',
  ANALYZING_TOPICS: 'Konular analiz ediliyor',
  GENERATING_REPORTS: 'Raporlar oluşturuluyor',
  WRITING_MANIFEST: 'Arşivleniyor',
}

const SCHEDULE_TIME_ZONE = 'Europe/Istanbul'
const HALF_HOUR_MS = 30 * 60 * 1000
/** Half of a marker (w-7 = 28px): the track spans marker centre to marker centre. */
const MARKER_INSET = '14px'

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SCHEDULE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
})
const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: SCHEDULE_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** The hero status line: what the daily schedule is doing right now. */
export function ScanScheduleStatus({ schedule }: { schedule: ScheduleView | null }) {
  const slots = schedule?.slots ?? []
  const active = slots.find((slot) => slot.state === 'RUNNING') ?? null
  const attention = slots.filter((slot) => slot.state === 'ATTENTION' || slot.state === 'DUE')

  return (
    <div className="flex flex-wrap items-center gap-3" data-purpose="live-cron-status">
      <div className={`relative flex items-center justify-center w-8 h-8 rounded-full border-2 shrink-0 ${active ? 'border-indigo-400/30 text-indigo-400' : 'border-slate-700 text-slate-500'}`}>
        {active && (
          <svg className="animate-spin w-8 h-8 -rotate-90 absolute text-indigo-500" fill="none" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="14" stroke="currentColor" strokeDasharray="70 30" strokeLinecap="round" strokeWidth="3.5" />
          </svg>
        )}
        <span className={`w-2.5 h-2.5 rounded-full ${active ? 'bg-indigo-400 animate-pulse' : 'bg-slate-600'}`} />
      </div>
      <div>
        <div className="flex items-center gap-2">
          <h4 className="text-base sm:text-lg font-bold text-white tracking-tight leading-none">
            {active ? 'Aktif Tarama Yürütülüyor' : attention.length > 0 ? 'Tarama Dikkat Bekliyor' : 'Günlük Taramalar Planlandı'}
          </h4>
          {active && (
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
            </span>
          )}
        </div>
        <p className="text-[11px] font-mono tracking-wider uppercase text-slate-400 mt-1">
          {schedule ? `${schedule.targetDate} • ${slots.filter((slot) => slot.state === 'COMPLETED').length}/${slots.length} TARAMA TAMAMLANDI` : 'ZAMANLAMA YÜKLENİYOR…'}
        </p>
      </div>
      {active && (
        <span className="inline-flex items-center px-3 py-1 rounded-lg text-xs font-bold tracking-wider uppercase bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 backdrop-blur-sm">
          {active.time} {active.label} Taraması
        </span>
      )}
    </div>
  )
}

export function ScanScheduleTimeline({ schedule }: { schedule: ScheduleView | null }) {
  const now = useHalfHourClock()
  const slots = schedule?.slots ?? []

  return (
    <div className="pt-6 border-t border-slate-800/80 mt-2 relative z-10" data-purpose="live-cron-process-bar">
      <div className="relative px-2 pt-2">
        <div className="relative flex items-center justify-between mb-4">
          <div className="absolute top-1/2 -translate-y-1/2 h-[3px] z-0" style={{ left: MARKER_INSET, right: MARKER_INSET }}>
            <div className="w-full h-full bg-slate-800 rounded-full" />
            <div
              className="absolute left-0 top-0 h-full bg-indigo-500 rounded-full shadow-sm shadow-indigo-500/50 transition-[width] duration-700"
              data-purpose="process-bar-fill"
              style={{ width: `${scheduleProgress(slots, schedule?.targetDate ?? null, now) * 100}%` }}
            />
          </div>
          {slots.map((slot) => <SlotMarker key={slot.key} slot={slot} />)}
          {slots.length === 0 && <div className="h-7" />}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {slots.map((slot) => <SlotCard key={slot.key} slot={slot} />)}
        </div>
      </div>
    </div>
  )
}

/**
 * Re-renders on every :00 and :30 so the bar creeps forward with the wall clock. The scan
 * states themselves arrive from the schedule poll, so a finer tick would buy nothing.
 */
function useHalfHourClock(): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timer = window.setTimeout(function tick() {
      const current = new Date()
      setNow(current)
      timer = window.setTimeout(tick, HALF_HOUR_MS - (current.getTime() % HALF_HOUR_MS))
    }, HALF_HOUR_MS - (Date.now() % HALF_HOUR_MS))
    return () => window.clearTimeout(timer)
  }, [])

  return now
}

/**
 * How far along the day the bar should be filled, as a 0–1 fraction of the marker track.
 * The clock drives it between the slot hours; a scan that already finished pulls it forward
 * so the bar never lags behind a marker that is visibly done.
 */
function scheduleProgress(slots: ScheduleSlot[], targetDate: string | null, now: Date): number {
  if (slots.length < 2) return 0
  const lastReached = slots.reduce(
    (last, slot, index) => slot.state === 'COMPLETED' || slot.state === 'RUNNING' || slot.state === 'ATTENTION' ? index : last,
    -1,
  )
  const stateProgress = lastReached < 0 ? 0 : lastReached / (slots.length - 1)
  return Math.max(stateProgress, clockProgress(slots, targetDate, now))
}

function clockProgress(slots: ScheduleSlot[], targetDate: string | null, now: Date): number {
  if (!targetDate) return 0
  const today = dateFormatter.format(now)
  if (targetDate < today) return 1
  if (targetDate > today) return 0

  const times = slots.map((slot) => minutesOfDay(slot.time))
  if (times.some(Number.isNaN)) return 0

  const current = minutesOfDay(timeFormatter.format(now))
  const last = times.length - 1
  if (current <= times[0]) return 0
  if (current >= times[last]) return 1

  let index = 0
  while (index < last && current >= times[index + 1]) index += 1
  const span = times[index + 1] - times[index]
  const within = span > 0 ? (current - times[index]) / span : 0
  return (index + within) / last
}

function minutesOfDay(time: string): number {
  const [hours, minutes] = time.split(':')
  return Number(hours) * 60 + Number(minutes)
}

function SlotMarker({ slot }: { slot: ScheduleSlot }) {
  if (slot.state === 'COMPLETED') {
    return (
      <div className="relative z-10 flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600 border-2 border-indigo-400 shadow-md shadow-indigo-900/50 text-white">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
          <path d="M4.5 12.75l6 6 9-13.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    )
  }
  if (slot.state === 'RUNNING') {
    return (
      <div className="relative z-10 flex items-center justify-center w-7 h-7 rounded-full bg-slate-900 border-2 border-indigo-400 ring-4 ring-indigo-500/20 shadow-lg text-indigo-400">
        <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-ping" />
      </div>
    )
  }
  if (slot.state === 'ATTENTION' || slot.state === 'DUE') {
    return (
      <div className="relative z-10 flex items-center justify-center w-7 h-7 rounded-full bg-amber-500/20 border-2 border-amber-400 text-amber-300 text-xs font-bold">!</div>
    )
  }
  return (
    <div className="relative z-10 flex items-center justify-center w-7 h-7 rounded-full bg-slate-800 border-2 border-slate-700 text-slate-500">
      <span className="w-2 h-2 rounded-full bg-slate-600" />
    </div>
  )
}

function SlotCard({ slot }: { slot: ScheduleSlot }) {
  const heading = `${slot.time} ${slot.label}`
  const body = (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-xs font-bold uppercase tracking-wider ${slot.state === 'RUNNING' ? 'text-indigo-300' : slot.state === 'PENDING' ? 'text-slate-400' : 'text-slate-200'}`}>{heading}</span>
        <SlotBadge slot={slot} />
      </div>
      <p className={`text-xs leading-relaxed ${slot.state === 'PENDING' ? 'text-slate-500' : 'text-slate-400'}`}>{slotSummary(slot)}</p>
    </>
  )

  const className = slot.state === 'RUNNING'
    ? 'space-y-1 bg-indigo-950/30 p-2.5 rounded-xl border border-indigo-500/30 -mt-1 block'
    : slot.state === 'ATTENTION' || slot.state === 'DUE'
      ? 'space-y-1 bg-amber-950/20 p-2.5 rounded-xl border border-amber-500/30 -mt-1 block'
      : slot.state === 'PENDING' ? 'space-y-1 opacity-75 block' : 'space-y-1 block'

  if (!slot.run) return <div className={className}>{body}</div>

  return (
    <Link to={`/runs/${slot.run.id}`} className={`${className} transition-colors hover:bg-slate-800/40`}>
      {body}
    </Link>
  )
}

function SlotBadge({ slot }: { slot: ScheduleSlot }) {
  if (slot.state === 'COMPLETED') return <span className="text-[10px] text-emerald-400 font-semibold">• Tamamlandı</span>
  if (slot.state === 'RUNNING') return <span className="text-[10px] bg-indigo-500/30 text-indigo-300 px-1.5 py-0.5 rounded font-semibold animate-pulse">İşleniyor</span>
  if (slot.state === 'ATTENTION') return <span className="text-[10px] text-amber-300 font-semibold">• Dikkat gerekiyor</span>
  if (slot.state === 'DUE') return <span className="text-[10px] text-amber-300 font-semibold">• Çalışmadı</span>
  return <span className="text-[10px] text-slate-500 font-medium">• Beklemede</span>
}

function slotSummary(slot: ScheduleSlot): string {
  if (!slot.run) {
    return slot.state === 'DUE'
      ? `Planlanan saat geçti, bu tarama için kayıt oluşmadı. ${slot.description}`
      : slot.description
  }
  if (slot.state === 'ATTENTION') {
    return slot.run.errorSummary ?? 'Tarama tamamlanamadı, ayrıntı için tıklayın.'
  }
  if (slot.state === 'RUNNING') {
    const stage = slot.run.currentStage ? STAGE_LABELS[slot.run.currentStage] ?? slot.run.currentStage : 'Sıraya alındı'
    return `${stage}. ${slot.run.documentCount} belge incelemede.`
  }
  return `${slot.run.documentCount} belge incelendi, ${slot.run.reportCount} bülten hazırlandı.`
}
