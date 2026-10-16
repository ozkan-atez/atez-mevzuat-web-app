import { describe, expect, it } from 'vitest'
import type { ScanRunSummary } from '../scans/types'
import { emptyScanFilters, filterScanRuns } from './scan-run-filters'

const run = (overrides: Partial<ScanRunSummary>): ScanRunSummary => ({
  id: 'scan', trigger: 'CRON', automationName: 'Gümrük', status: 'COMPLETED', currentStage: null,
  targetDate: '2026-10-13', createdAt: '2026-10-13T02:00:00Z', startedAt: null, completedAt: null,
  counts: { documents: 2, assets: 0, editions: 1 }, ...overrides,
})

describe('dashboard scan filters', () => {
  it('combines inclusive date, automation, type, status and document filters', () => {
    const matching = run({ id: 'match' })
    const runs = [matching, run({ id: 'other-name', automationName: 'Diğer' }), run({ id: 'manual', trigger: 'MANUAL' }), run({ id: 'old', targetDate: '2026-10-12' }), run({ id: 'failed', status: 'FAILED' })]
    expect(filterScanRuns(runs, { ...emptyScanFilters, from: '2026-10-13', to: '2026-10-13', automation: 'Gümrük', type: 'CRON', status: 'COMPLETED', documents: 'FOUND' })).toEqual([matching])
  })
  it('uses Istanbul time and supports ranges crossing midnight', () => {
    const late = run({ id: 'late', createdAt: '2026-10-13T20:30:00Z' })
    const early = run({ id: 'early', createdAt: '2026-10-13T22:00:00Z' })
    const morning = run({ id: 'morning' })
    expect(filterScanRuns([late, early, morning], { ...emptyScanFilters, startTime: '23:00', endTime: '02:00' })).toEqual([late, early])
    expect(filterScanRuns([morning], { ...emptyScanFilters, startTime: '05:00', endTime: '05:00' })).toEqual([morning])
  })
  it('does not classify failed or pending scans as completed without documents', () => {
    const empty = { documents: 0, assets: 0, editions: 0 }
    const completed = run({ counts: empty })
    expect(filterScanRuns([completed, run({ status: 'RUNNING', counts: empty }), run({ status: 'FAILED', counts: empty })], { ...emptyScanFilters, documents: 'EMPTY' })).toEqual([completed])
  })
  it('restores every row when filters are cleared', () => {
    const runs = [run({}), run({ trigger: 'MANUAL' })]
    expect(filterScanRuns(runs, emptyScanFilters)).toEqual(runs)
  })
})
