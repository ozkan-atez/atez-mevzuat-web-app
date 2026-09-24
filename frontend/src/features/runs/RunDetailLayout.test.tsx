import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunDetail } from './RunDetail'

afterEach(() => cleanup())

const run = {
  id: 'run-layout',
  status: 'COMPLETED',
  currentStage: 'WRITING_MANIFEST',
  targetDate: '2026-09-13',
  startedAt: '2026-09-13T07:00:00.000Z',
  completedAt: '2026-09-13T07:02:00.000Z',
  errorSummary: null,
  sourceKeys: ['resmi-gazete', 'igmd'],
  sourceResults: [{ id: 'source-1', sourceKey: 'igmd', sourceName: 'İGMD', status: 'COMPLETED', documentCount: 0, errorSummary: null, hasReport: false, documents: [] }],
  filter: { status: 'COMPLETED', counts: { in: 2, out: 2, pending: 0 }, retryAvailable: false, errorCategory: null, errorMessage: null },
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
  it('places operation groups in the overview and starts their details collapsed', async () => {
    renderDetail()

    const overview = await screen.findByTestId('run-overview')
    const summary = within(overview).getByRole('region', { name: 'Operasyon özeti' })

    expect(within(overview).getByRole('heading', { name: 'Tarama İnceleme Masası' })).toBeVisible()
    expect(within(overview).getByRole('region', { name: 'Operasyon Adımları' })).toBeVisible()
    expect(within(summary).getByText('4')).toBeVisible()
    expect(within(summary).getByText('2')).toBeVisible()
    expect(screen.getByRole('button', { name: /^Durum noktası: Tarama —/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /^Durum noktası: Filtreleme —/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /^Durum noktası: Hazırlık —/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /^Durum noktası: Analiz —/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /^Durum noktası: Raporlama —/ })).toBeVisible()
    expect(screen.queryByText('Resmî Gazete yayınları bulunuyor')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tarama' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Durum noktası: Tarama —/ }))
    expect(screen.getByText('Resmî Gazete yayınları bulunuyor')).toBeVisible()
    expect(screen.getByText('İGMD kaynağı tarandı')).toBeVisible()
    expect(screen.getByText('İlgili gün için yeni mevzuat kaydı bulunmadı.')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Kaynak durumları' })).not.toBeInTheDocument()

    const marker = screen.getByRole('button', { name: 'Durum noktası: Tarama — Tamamlandı' })
    await userEvent.click(marker)
    expect(screen.queryByText('Resmî Gazete yayınları bulunuyor')).not.toBeInTheDocument()
    await userEvent.click(marker)
    expect(screen.getByText('Resmî Gazete yayınları bulunuyor')).toBeVisible()
  })
})
