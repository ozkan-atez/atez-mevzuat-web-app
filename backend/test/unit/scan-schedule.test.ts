import { describe, expect, it, vi } from 'vitest'
import { SCAN_SCHEDULE, cronExpressionFor, scheduleRequestKey } from '../../src/modules/scan-runs/domain/scan-schedule'
import { registerScanSchedules, resolveScheduledTargetDate, type ScheduleRegistrar } from '../../src/modules/scan-runs/application/register-scan-schedules'
import { buildScheduleView, type ScheduledRunRow } from '../../src/modules/scan-runs/application/build-schedule-view'

const QUEUE = 'resmi-gazete-scheduled-scan'

function run(overrides: Partial<ScheduledRunRow>): ScheduledRunRow {
  return {
    id: 'run-1', slotKey: 'ANA_SAYI', status: 'COMPLETED', currentStage: null, errorSummary: null,
    startedAt: null, completedAt: null, createdAt: '2026-09-14T02:00:00.000Z',
    editionCount: 1, documentCount: 9, reportCount: 2,
    ...overrides,
  }
}

describe('scan schedule', () => {
  it('runs the four daily scans at 05, 10, 15 and 23 local time', () => {
    expect(SCAN_SCHEDULE.map((slot) => slot.hour)).toEqual([5, 10, 15, 23])
    expect(SCAN_SCHEDULE.map(cronExpressionFor)).toEqual(['0 5 * * *', '0 10 * * *', '0 15 * * *', '0 23 * * *'])
  })

  it('keys a scheduled run by date and slot so a repeated firing reuses the run', () => {
    expect(scheduleRequestKey('2026-09-14', 'MUKERRER_2')).toBe('cron:2026-09-14:MUKERRER_2')
  })
})

describe('registerScanSchedules', () => {
  it('registers every slot in the configured timezone', async () => {
    const schedule = vi.fn().mockResolvedValue(undefined)
    const registrar: ScheduleRegistrar = { schedule, unschedule: vi.fn(), getSchedules: async () => [] }

    await registerScanSchedules(registrar, { queueName: QUEUE, timezone: 'Europe/Istanbul' })

    expect(schedule).toHaveBeenCalledTimes(4)
    expect(schedule).toHaveBeenCalledWith(QUEUE, '0 23 * * *', { slotKey: 'GUN_SONU' }, { tz: 'Europe/Istanbul', key: 'GUN_SONU', missed: 'once' })
  })

  it('gives every slot its own key so the four registrations do not overwrite each other', async () => {
    const schedule = vi.fn().mockResolvedValue(undefined)
    const registrar: ScheduleRegistrar = { schedule, unschedule: vi.fn(), getSchedules: async () => [] }

    await registerScanSchedules(registrar, { queueName: QUEUE, timezone: 'Europe/Istanbul' })

    const keys = schedule.mock.calls.map((call) => (call[3] as { key: string }).key)
    expect(new Set(keys).size).toBe(4)
    expect(keys).toEqual(['ANA_SAYI', 'MUKERRER_1', 'MUKERRER_2', 'GUN_SONU'])
  })

  it('drops cron rows for slots that are no longer scheduled', async () => {
    const unschedule = vi.fn().mockResolvedValue(undefined)
    const registrar: ScheduleRegistrar = {
      schedule: vi.fn(), unschedule,
      getSchedules: async () => [
        { name: QUEUE, key: 'ANA_SAYI' },
        { name: QUEUE, key: 'OGLE_ARASI' },
        { name: 'other-queue', key: 'BASKA' },
      ],
    }

    await registerScanSchedules(registrar, { queueName: QUEUE, timezone: 'Europe/Istanbul' })

    expect(unschedule).toHaveBeenCalledExactlyOnceWith(QUEUE, 'OGLE_ARASI')
  })
})

describe('resolveScheduledTargetDate', () => {
  it('targets the local day a scan fires on', () => {
    expect(resolveScheduledTargetDate({ slotHour: 23, localHour: 23, localDate: '2026-09-14' })).toBe('2026-09-14')
  })

  it('targets the previous day when a missed firing is recovered after midnight', () => {
    // A 23:00 job recovered at 00:30 belongs to the day that just ended, otherwise it
    // would consume the new day's slot and the real 23:00 run would be skipped.
    expect(resolveScheduledTargetDate({ slotHour: 23, localHour: 0, localDate: '2026-09-15' })).toBe('2026-09-14')
  })

  it('handles a month boundary when recovering', () => {
    expect(resolveScheduledTargetDate({ slotHour: 23, localHour: 1, localDate: '2026-10-01' })).toBe('2026-09-30')
  })
})

describe('buildScheduleView', () => {
  it('marks an hour that passed without a run as overdue, and later hours as pending', () => {
    const view = buildScheduleView({ targetDate: '2026-09-14', localHour: 11, runs: [] })

    expect(view.slots.map((slot) => slot.state)).toEqual(['DUE', 'DUE', 'PENDING', 'PENDING'])
    expect(view.slots.map((slot) => slot.time)).toEqual(['05:00', '10:00', '15:00', '23:00'])
  })

  it('exposes the run so the dashboard can link to its results', () => {
    const view = buildScheduleView({
      targetDate: '2026-09-14', localHour: 11,
      runs: [run({ id: 'run-abc', slotKey: 'ANA_SAYI', reportCount: 3 })],
    })

    expect(view.slots[0]).toMatchObject({ state: 'COMPLETED', run: { id: 'run-abc', reportCount: 3 } })
  })

  it('separates an in-flight run from one that needs attention', () => {
    const view = buildScheduleView({
      targetDate: '2026-09-14', localHour: 16,
      runs: [
        run({ slotKey: 'ANA_SAYI', status: 'RUNNING', currentStage: 'AI_FILTERING' }),
        run({ slotKey: 'MUKERRER_1', status: 'QUEUED' }),
        run({ slotKey: 'MUKERRER_2', status: 'AWAITING_RETRY', errorSummary: 'Gemini yoğun' }),
      ],
    })

    expect(view.slots.map((slot) => slot.state)).toEqual(['RUNNING', 'RUNNING', 'ATTENTION', 'PENDING'])
    expect(view.slots[2]?.run?.errorSummary).toBe('Gemini yoğun')
  })

  it('treats every unrun slot of a past day as overdue', () => {
    const view = buildScheduleView({ targetDate: '2026-09-13', localHour: 24, runs: [] })

    expect(view.slots.every((slot) => slot.state === 'DUE')).toBe(true)
  })
})
