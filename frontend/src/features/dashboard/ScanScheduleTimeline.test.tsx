import { MemoryRouter } from 'react-router-dom'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScanScheduleStatus, ScanScheduleTimeline } from './ScanScheduleTimeline'
import type { ScheduleSlot, ScheduleView } from '../scans/types'

function slot(overrides: Partial<ScheduleSlot>): ScheduleSlot {
  return {
    key: 'ANA_SAYI', label: 'Ana Sayı', time: '05:00', description: 'Günün ana sayısı taranır.',
    state: 'PENDING', run: null,
    ...overrides,
  }
}

function schedule(slots: ScheduleSlot[], targetDate = '2026-09-14'): ScheduleView {
  return { targetDate, slots }
}

const DAILY_SLOTS = [
  slot({ key: 'ANA_SAYI', time: '05:00', label: 'Ana Sayı' }),
  slot({ key: 'MUKERRER_1', time: '10:00', label: '1. Mükerrer' }),
  slot({ key: 'MUKERRER_2', time: '15:00', label: '2. Mükerrer' }),
  slot({ key: 'GUN_SONU', time: '23:00', label: 'Gün Sonu' }),
]

function renderTimeline(view: ScheduleView) {
  render(<MemoryRouter><ScanScheduleTimeline schedule={view} /></MemoryRouter>)
}

function fillWidth(): string {
  const fill = document.querySelector('[data-purpose="process-bar-fill"]')
  if (!(fill instanceof HTMLElement)) throw new Error('process bar fill not rendered')
  return fill.style.width
}

describe('ScanScheduleTimeline', () => {
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('renders the four daily slots from the server, not a hardcoded list', () => {
    renderTimeline(schedule(DAILY_SLOTS))

    expect(screen.getByText('05:00 Ana Sayı')).toBeVisible()
    expect(screen.getByText('23:00 Gün Sonu')).toBeVisible()
  })

  it('links a completed slot to its scan run and summarises the results', () => {
    renderTimeline(schedule([
      slot({
        state: 'COMPLETED',
        run: {
          id: 'run-abc', status: 'COMPLETED', currentStage: null, errorSummary: null,
          editionCount: 2, documentCount: 9, reportCount: 3, startedAt: null, completedAt: null,
        },
      }),
    ]))

    const link = screen.getByRole('link', { name: /05:00 Ana Sayı/ })
    expect(link).toHaveAttribute('href', '/runs/run-abc')
    expect(screen.getByText('9 belge incelendi, 3 bülten hazırlandı.')).toBeVisible()
  })

  it('surfaces a slot whose hour passed without any run', () => {
    renderTimeline(schedule([slot({ state: 'DUE' })]))

    expect(screen.getByText('• Çalışmadı')).toBeVisible()
    expect(screen.getByText(/Planlanan saat geçti/)).toBeVisible()
  })

  it('shows the failure reason on a run that needs attention', () => {
    renderTimeline(schedule([
      slot({
        state: 'ATTENTION',
        run: {
          id: 'run-err', status: 'AWAITING_RETRY', currentStage: 'AI_FILTERING', errorSummary: 'Gemini servisi yoğun.',
          editionCount: 1, documentCount: 7, reportCount: 0, startedAt: null, completedAt: null,
        },
      }),
    ]))

    expect(screen.getByText('Gemini servisi yoğun.')).toBeVisible()
    expect(screen.getByRole('link', { name: /05:00 Ana Sayı/ })).toHaveAttribute('href', '/runs/run-err')
  })

  it('advances the bar with the Istanbul clock between two slot hours', () => {
    // 12:30 Istanbul: half of the 10:00 → 15:00 leg, so 1.5 of the 3 marker gaps.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T09:30:00Z'))

    renderTimeline(schedule(DAILY_SLOTS))

    expect(fillWidth()).toBe('50%')
  })

  it('keeps the bar empty before the first scan hour and full after the last', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T01:00:00Z')) // 04:00 Istanbul
    renderTimeline(schedule(DAILY_SLOTS))
    expect(fillWidth()).toBe('0%')

    cleanup()
    vi.setSystemTime(new Date('2026-09-14T20:30:00Z')) // 23:30 Istanbul
    renderTimeline(schedule(DAILY_SLOTS))
    expect(fillWidth()).toBe('100%')
  })

  it('never falls behind a scan that already completed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T03:00:00Z')) // 06:00 Istanbul, only just past the first slot
    renderTimeline(schedule([
      DAILY_SLOTS[0],
      { ...DAILY_SLOTS[1], state: 'COMPLETED' },
      { ...DAILY_SLOTS[2], state: 'COMPLETED' },
      DAILY_SLOTS[3],
    ]))

    expect(fillWidth()).toBe(`${(2 / 3) * 100}%`)
  })

  it('shows a past target date as a finished day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-20T06:00:00Z'))

    renderTimeline(schedule(DAILY_SLOTS, '2026-09-14'))

    expect(fillWidth()).toBe('100%')
  })
})

describe('ScanScheduleStatus', () => {
  afterEach(cleanup)

  it('reports the day and how many scans are done', () => {
    render(<ScanScheduleStatus schedule={schedule(DAILY_SLOTS)} />)

    expect(screen.getByText('Günlük Taramalar Planlandı')).toBeVisible()
    expect(screen.getByText(/0\/4 TARAMA TAMAMLANDI/)).toBeVisible()
  })

  it('names the running scan while one is in flight', () => {
    render(<ScanScheduleStatus schedule={schedule([
      { ...DAILY_SLOTS[0], state: 'COMPLETED' },
      { ...DAILY_SLOTS[1], state: 'RUNNING' },
    ])} />)

    expect(screen.getByText('Aktif Tarama Yürütülüyor')).toBeVisible()
    expect(screen.getByText('10:00 1. Mükerrer Taraması')).toBeVisible()
  })

  it('waits for the schedule before claiming anything', () => {
    render(<ScanScheduleStatus schedule={null} />)

    expect(screen.getByText('ZAMANLAMA YÜKLENİYOR…')).toBeVisible()
  })
})
