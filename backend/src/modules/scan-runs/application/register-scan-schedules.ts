import { SCAN_SCHEDULE, cronExpressionFor, type ScanScheduleSlotKey } from '../domain/scan-schedule'

export interface ScheduleRegistrar {
  schedule(
    queueName: string,
    cron: string,
    data: { slotKey: ScanScheduleSlotKey },
    options: { tz: string; key: string; missed: 'once' | 'skip' },
  ): Promise<void>
  /** pg-boss keys schedules by (queue, key), so the key identifies the slot to drop. */
  unschedule(queueName: string, key: string): Promise<void>
  getSchedules(): Promise<Array<{ name: string; key: string }>>
}

/**
 * Re-registers the daily scans on every worker start so the cron rows always match
 * SCAN_SCHEDULE, and drops rows for slots that no longer exist — otherwise a removed
 * slot would keep firing from its old row.
 *
 * Each slot gets its own key because pg-boss stores one schedule per (queue, key);
 * without distinct keys the four registrations overwrite each other and only the
 * last hour survives.
 */
export async function registerScanSchedules(
  registrar: ScheduleRegistrar,
  options: { queueName: string; timezone: string },
): Promise<{ registered: string[] }> {
  const wanted = new Set<string>(SCAN_SCHEDULE.map((slot) => slot.key))

  const existing = await registrar.getSchedules()
  for (const schedule of existing) {
    if (schedule.name === options.queueName && !wanted.has(schedule.key)) {
      await registrar.unschedule(options.queueName, schedule.key)
    }
  }

  for (const slot of SCAN_SCHEDULE) {
    await registrar.schedule(
      options.queueName,
      cronExpressionFor(slot),
      { slotKey: slot.key },
      // 'once' recovers a scan that came due while the worker was down; the handler
      // resolves which gazette day that missed occurrence belongs to.
      { tz: options.timezone, key: slot.key, missed: 'once' },
    )
  }

  return { registered: SCAN_SCHEDULE.map((slot) => `${slot.key}@${cronExpressionFor(slot)}`) }
}

/**
 * Resolves the gazette day a firing belongs to. A scan that fires on time targets the
 * current local day; a recovered one that arrives before its own hour belongs to the
 * previous day, so a late 23:00 job cannot consume the next day's slot.
 */
export function resolveScheduledTargetDate(input: { slotHour: number; localHour: number; localDate: string }): string {
  if (input.localHour >= input.slotHour) return input.localDate
  const [year, month, day] = input.localDate.split('-').map(Number) as [number, number, number]
  const previous = new Date(Date.UTC(year, month - 1, day - 1))
  return previous.toISOString().slice(0, 10)
}
