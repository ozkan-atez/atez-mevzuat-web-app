import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { RunDetail } from './RunDetail'

const run = {
  id: 'run-layout',
  status: 'COMPLETED',
  currentStage: 'WRITING_MANIFEST',
  targetDate: '2026-09-13',
  startedAt: '2026-09-13T07:00:00.000Z',
  completedAt: '2026-09-13T07:02:00.000Z',
  errorSummary: null,
  counts: { editions: 1, documents: 4, assets: 2, completedItems: 2, totalItems: 4, failedItems: 0 },
  stages: [
    {
      stage: 'DISCOVERING',
      status: 'COMPLETED',
      completedItems: 4,
      totalItems: 4,
      failedItems: 0,
    },
  ],
  editions: [],
}

function renderDetail() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(run), { status: 200 })))
  render(
    <MemoryRouter initialEntries={['/runs/run-layout']}>
      <Routes>
        <Route path="/runs/:id" element={<RunDetail />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RunDetail overview layout', () => {
  it('keeps the live summary beside the review title and opens operation steps by default', async () => {
    renderDetail()

    const overview = await screen.findByTestId('run-overview')
    const summary = within(overview).getByRole('region', { name: 'Operasyon özeti' })

    expect(within(overview).getByRole('heading', { name: 'Tarama İnceleme Masası' })).toBeVisible()
    expect(within(summary).getByText('4')).toBeVisible()
    expect(within(summary).getByText('2')).toBeVisible()
    expect(screen.getByText('Yayınlar keşfediliyor')).toBeVisible()
  })
})
