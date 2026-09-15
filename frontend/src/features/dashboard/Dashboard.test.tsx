import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { Dashboard } from './Dashboard'

// The dashboard fetches the run list and the daily schedule, so the stub routes by
// URL and builds a fresh Response per call — a shared Response body reads only once.
function stubFetch(runs: unknown[]) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(
    url.includes('/schedule')
      ? new Response(JSON.stringify({ targetDate: '2026-09-14', slots: [] }), { status: 200 })
      : new Response(JSON.stringify({ runs }), { status: 200 }),
  )))
}

describe('Dashboard recent scans', () => {
  it('shows persisted scan runs instead of bulletin mock rows', async () => {
    stubFetch([{
      id: 'a07a03dc-2712-4bee-b852-bfa00f06a27a',
      trigger: 'MANUAL', status: 'COMPLETED', currentStage: 'WRITING_MANIFEST', targetDate: '2026-09-14',
      createdAt: '2026-09-13T21:41:30.000Z', startedAt: '2026-09-13T21:41:30.969Z', completedAt: '2026-09-13T21:41:36.265Z',
      counts: { editions: 1, documents: 7, assets: 1 },
    }])

    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(await screen.findByText('7 belge · 1 bağlı dosya · 1 sayı')).toBeVisible()
    expect(screen.getByText('a07a03dc')).toBeVisible()
    expect(screen.queryByText('İthalatta Haksız Rekabetin Önlenmesine İlişkin Tebliğ (No: 2026/4)')).not.toBeInTheDocument()
  })

  it('labels a paused Gemini run as waiting for the AI filter', async () => {
    stubFetch([{
      id: 'bf6f1a0b-11dc-4fee-8847-fc61c2b93ec3',
      trigger: 'MANUAL', status: 'AWAITING_RETRY', currentStage: 'AI_FILTERING', targetDate: '2026-07-11',
      createdAt: '2026-09-13T22:44:20.000Z', startedAt: '2026-09-13T22:44:21.000Z', completedAt: null,
      counts: { editions: 1, documents: 62, assets: 0 },
    }])

    render(<MemoryRouter><Dashboard /></MemoryRouter>)

    expect(await screen.findByText('AI filtresi bekliyor')).toBeVisible()
  })
})
