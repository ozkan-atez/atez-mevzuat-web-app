import { MemoryRouter } from 'react-router-dom'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScanScheduleTimeline } from './ScanScheduleTimeline'
import type { ScheduleSlot } from '../scans/types'

function slot(overrides: Partial<ScheduleSlot>): ScheduleSlot {
  return {
    key: 'ANA_SAYI', label: 'Ana Sayı', time: '05:00', description: 'Günün ana sayısı taranır.',
    state: 'PENDING', run: null,
    ...overrides,
  }
}

function mockSchedule(slots: ScheduleSlot[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ targetDate: '2026-09-14', slots }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  ))
}

describe('ScanScheduleTimeline', () => {
  afterEach(cleanup)

  it('renders the four daily slots from the server, not a hardcoded list', async () => {
    mockSchedule([
      slot({ key: 'ANA_SAYI', time: '05:00', label: 'Ana Sayı' }),
      slot({ key: 'MUKERRER_1', time: '10:00', label: '1. Mükerrer' }),
      slot({ key: 'MUKERRER_2', time: '15:00', label: '2. Mükerrer' }),
      slot({ key: 'GUN_SONU', time: '23:00', label: 'Gün Sonu' }),
    ])

    render(<MemoryRouter><ScanScheduleTimeline /></MemoryRouter>)

    expect(await screen.findByText('05:00 Ana Sayı')).toBeVisible()
    expect(screen.getByText('23:00 Gün Sonu')).toBeVisible()
    expect(screen.getByText(/0\/4 TARAMA TAMAMLANDI/)).toBeVisible()
  })

  it('links a completed slot to its scan run and summarises the results', async () => {
    mockSchedule([
      slot({
        state: 'COMPLETED',
        run: {
          id: 'run-abc', status: 'COMPLETED', currentStage: null, errorSummary: null,
          editionCount: 2, documentCount: 9, reportCount: 3, startedAt: null, completedAt: null,
        },
      }),
    ])

    render(<MemoryRouter><ScanScheduleTimeline /></MemoryRouter>)

    const link = await screen.findByRole('link', { name: /05:00 Ana Sayı/ })
    expect(link).toHaveAttribute('href', '/runs/run-abc')
    expect(screen.getByText('9 belge incelendi, 3 bülten hazırlandı.')).toBeVisible()
  })

  it('surfaces a slot whose hour passed without any run', async () => {
    mockSchedule([slot({ state: 'DUE' })])

    render(<MemoryRouter><ScanScheduleTimeline /></MemoryRouter>)

    expect(await screen.findByText('• Çalışmadı')).toBeVisible()
    expect(screen.getByText(/Planlanan saat geçti/)).toBeVisible()
  })

  it('shows the failure reason on a run that needs attention', async () => {
    mockSchedule([
      slot({
        state: 'ATTENTION',
        run: {
          id: 'run-err', status: 'AWAITING_RETRY', currentStage: 'AI_FILTERING', errorSummary: 'Gemini servisi yoğun.',
          editionCount: 1, documentCount: 7, reportCount: 0, startedAt: null, completedAt: null,
        },
      }),
    ])

    render(<MemoryRouter><ScanScheduleTimeline /></MemoryRouter>)

    expect(await screen.findByText('Gemini servisi yoğun.')).toBeVisible()
    expect(screen.getByRole('link', { name: /05:00 Ana Sayı/ })).toHaveAttribute('href', '/runs/run-err')
  })
})
