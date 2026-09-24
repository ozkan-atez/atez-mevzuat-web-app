import { SCAN_SCHEDULE, type ScanScheduleSlotKey } from '../domain/scan-schedule'
import type { ScanRunStatus, ScanStage } from '../domain/scan-run'

export type ScheduleSlotState = 'COMPLETED' | 'RUNNING' | 'ATTENTION' | 'DUE' | 'PENDING'

export interface ScheduledRunRow {
  id: string
  slotKey: ScanScheduleSlotKey
  status: ScanRunStatus
  currentStage: ScanStage | null
  errorSummary: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  editionCount: number
  documentCount: number
  reportCount: number
}

export interface ScheduleSlotView {
  key: ScanScheduleSlotKey
  label: string
  time: string
  description: string
  state: ScheduleSlotState
  run: null | {
    id: string
    status: ScanRunStatus
    currentStage: ScanStage | null
    errorSummary: string | null
    editionCount: number
    documentCount: number
    reportCount: number
    startedAt: string | null
    completedAt: string | null
  }
}

interface Input {
  targetDate: string
  /** Local time in the schedule timezone, so "due" reflects the user's day. */
  localHour: number
  runs: ScheduledRunRow[]
}

export function buildScheduleView(input: Input): { targetDate: string; slots: ScheduleSlotView[] } {
  const bySlot = new Map(input.runs.map((run) => [run.slotKey, run]))

  return {
    targetDate: input.targetDate,
    slots: SCAN_SCHEDULE.map((slot) => {
      const run = bySlot.get(slot.key) ?? null
      return {
        key: slot.key,
        label: slot.label,
        time: `${String(slot.hour).padStart(2, '0')}:00`,
        description: slot.description,
        state: resolveState(run, slot.hour, input.localHour),
        run: run
          ? {
            id: run.id,
            status: run.status,
            currentStage: run.currentStage,
            errorSummary: run.errorSummary,
            editionCount: run.editionCount,
            documentCount: run.documentCount,
            reportCount: run.reportCount,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
          }
          : null,
      }
    }),
  }
}

function resolveState(run: ScheduledRunRow | null, slotHour: number, localHour: number): ScheduleSlotState {
  if (!run) {
    // The hour has passed with no run at all — the cron did not fire, which the
    // dashboard must surface rather than showing a calm "waiting" slot.
    return localHour >= slotHour ? 'DUE' : 'PENDING'
  }
  if (run.status === 'COMPLETED') return 'COMPLETED'
  if (run.status === 'QUEUED' || run.status === 'RUNNING') return 'RUNNING'
  return 'ATTENTION'
}
