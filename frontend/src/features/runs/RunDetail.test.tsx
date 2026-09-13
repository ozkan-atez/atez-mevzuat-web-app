import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { RunDetail } from './RunDetail'

class SilentEventSource {
  addEventListener() {}
  close() {}
}

function renderDetail() {
  render(<MemoryRouter initialEntries={['/runs/run-1']}><Routes><Route path="/runs/:id" element={<RunDetail />} /></Routes></MemoryRouter>)
}

describe('RunDetail', () => {
  it('renders backend operation stages and collected documents', async () => {
    const run = {
      id: 'run-1', status: 'RUNNING', currentStage: 'DOWNLOADING_ASSETS', targetDate: '2026-07-11',
      startedAt: '2026-07-11T04:00:00.000Z', completedAt: null, errorSummary: null,
      counts: { editions: 1, documents: 1, assets: 2, completedItems: 1, totalItems: 2, failedItems: 0 },
      stages: [],
      editions: [{ id: 'edition-1', type: 'MAIN', supplementNo: null, documents: [{
        id: 'document-1', title: 'Örnek Resmî Gazete Kararı', sourceUrl: 'https://www.resmigazete.gov.tr/20260711-1.htm', validationStatus: 'VALID', assetCount: 2,
      }] }],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(run), { status: 200 })))
    vi.stubGlobal('EventSource', SilentEventSource)
    renderDetail()

    expect(await screen.findByText('Varlıklar indiriliyor')).toBeVisible()
    expect(screen.getByText('Örnek Resmî Gazete Kararı')).toBeVisible()
    expect(screen.queryByText('39 gümrük & dış ticaret maddesi')).not.toBeInTheDocument()
  })

  it('shows a real not-found state instead of dummy data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
    renderDetail()
    expect(await screen.findByText('Tarama bulunamadı')).toBeVisible()
    expect(screen.queryByText('PET Resin')).not.toBeInTheDocument()
  })
})
