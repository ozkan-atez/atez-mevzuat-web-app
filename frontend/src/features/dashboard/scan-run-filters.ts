import type { ScanRunSummary } from '../scans/types'

export const emptyScanFilters = { from: '', to: '', automation: '', type: '', startTime: '', endTime: '', status: '', documents: '' }
export type ScanFilters = typeof emptyScanFilters
const istanbulTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
export const scanName = (run: ScanRunSummary) => run.automationName ?? run.scheduleLabel ?? (run.trigger === 'CRON' ? 'Zamanlanmış tarama' : 'Manuel tarama')

export function filterScanRuns(runs: ScanRunSummary[], filters: ScanFilters) {
  return runs.filter(run => {
    const time = istanbulTime.format(new Date(run.createdAt))
    const overnight = filters.startTime && filters.endTime && filters.startTime > filters.endTime
    const matchesTime = overnight
      ? time >= filters.startTime || time <= filters.endTime
      : (!filters.startTime || time >= filters.startTime) && (!filters.endTime || time <= filters.endTime)
    return (!filters.from || run.targetDate >= filters.from)
      && (!filters.to || run.targetDate <= filters.to)
      && (!filters.automation || (run.trigger === 'CRON' && scanName(run) === filters.automation))
      && (!filters.type || run.trigger === filters.type)
      && (!filters.status || run.status === filters.status)
      && (!filters.documents || (filters.documents === 'FOUND' ? run.counts.documents > 0 : run.status === 'COMPLETED' && run.counts.documents === 0))
      && matchesTime
  })
}
