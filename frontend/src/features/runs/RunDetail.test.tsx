import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
      filter: { status: 'COMPLETED', counts: { in: 1, out: 0, pending: 0 }, retryAvailable: false, errorCategory: null, errorMessage: null },
      previousSources: { status: 'RUNNING', counts: { total: 1, completed: 0, verified: 0, notRequired: 0, notFound: 0, ambiguous: 0, pending: 1 }, retryAvailable: false, errorMessage: null },
      analysis: { counts: { total: 1, completed: 0, awaitingRetry: 0, failed: 0 }, topics: [] }, reports: [],
      counts: { editions: 1, documents: 1, assets: 2, completedItems: 1, totalItems: 2, failedItems: 0 },
      stages: [],
      editions: [{ id: 'edition-1', type: 'MAIN', supplementNo: null, documents: [{
        id: 'document-1', title: 'Örnek Resmî Gazete Kararı', sourceUrl: 'https://www.resmigazete.gov.tr/20260711-1.htm', validationStatus: 'VALID', assetCount: 2,
        filter: { titleDecision: 'MAYBE', finalDecision: 'IN', reason: 'İçerikte ithalat düzenlemesi bulunuyor.' },
        previousSource: { status: 'COMPLETED', outcome: 'VERIFIED', needsPreviousSource: true, reason: '2018/5 sayılı Tebliği değiştiriyor.', title: 'İthalat Rejimi Kararına Ek Karar', publicationDate: '2025-12-31', gazetteNo: '33124', sourceUrl: 'https://www.resmigazete.gov.tr/eskiler/2025/12/20251231M4-39.pdf' },
      }] }],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(run), { status: 200 })))
    vi.stubGlobal('EventSource', SilentEventSource)
    renderDetail()

    expect(await screen.findByText('Varlıklar indiriliyor')).toBeVisible()
    expect(screen.getByText('Gümrük ve dış ticaret ilgisi belirleniyor')).toBeVisible()
    expect(screen.getByText('Önceki kaynaklar hazırlanıyor')).toBeVisible()
    expect(screen.getByText('Mevzuat değişiklikleri analiz ediliyor')).toBeVisible()
    expect(screen.getByText('Raporlar oluşturuluyor')).toBeVisible()
    expect(screen.getByText('Örnek Resmî Gazete Kararı')).toBeVisible()
    expect(screen.getByText('İlgili')).toBeVisible()
    expect(screen.getByText('İçerikte ithalat düzenlemesi bulunuyor.')).toBeVisible()
    expect(screen.getByRole('link', { name: /Önceki kaynak/ })).toHaveAttribute('href', 'https://www.resmigazete.gov.tr/eskiler/2025/12/20251231M4-39.pdf')
    expect(document.body.textContent).not.toMatch(/güven puanı|confidence/i)
    expect(screen.queryByText('39 gümrük & dış ticaret maddesi')).not.toBeInTheDocument()
  })

  it('shows only the no-change report when the run has no relevant topic', async () => {
    const run = {
      id: 'run-1', status: 'COMPLETED', currentStage: 'WRITING_MANIFEST', targetDate: '2026-09-11', startedAt: null, completedAt: '2026-09-11T05:00:00.000Z', errorSummary: null,
      filter: { status: 'COMPLETED', counts: { in: 0, out: 7, pending: 0 }, retryAvailable: false, errorCategory: null, errorMessage: null }, previousSources: null,
      analysis: { counts: { total: 0, completed: 0, awaitingRetry: 0, failed: 0 }, topics: [] },
      reports: [{ id: 'report-1', topicId: null, title: 'Değişiklik Yok', basename: '00-degisiklik-yok.html', card: 'K6', version: 1, htmlObjectKey: 'runs/no-change.html' }],
      counts: { editions: 1, documents: 7, assets: 0, completedItems: 1, totalItems: 1, failedItems: 0 }, stages: [], editions: [],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(run), { status: 200 })))
    renderDetail()
    expect(await screen.findByText('Değişiklik bulunmadı')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Değişiklik yok raporunu aç' })).toBeInTheDocument()
    expect(screen.queryByText('Topic analizi')).not.toBeInTheDocument()
  })

  it('shows a real not-found state instead of dummy data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
    renderDetail()
    expect(await screen.findByText('Tarama bulunamadı')).toBeVisible()
    expect(screen.queryByText('PET Resin')).not.toBeInTheDocument()
  })

  it('does not open a live connection for an already completed run', async () => {
    const run = {
      id: 'run-1', status: 'COMPLETED', currentStage: 'WRITING_MANIFEST', targetDate: '2026-07-11',
      startedAt: null, completedAt: '2026-07-11T05:00:00.000Z', errorSummary: null,
      filter: null,
      counts: { editions: 0, documents: 0, assets: 0, completedItems: 1, totalItems: 1, failedItems: 0 },
      stages: [], editions: [],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(run), { status: 200 })))
    const EventSourceConstructor = vi.fn()
    vi.stubGlobal('EventSource', EventSourceConstructor)

    renderDetail()

    expect(await screen.findByText('Tamamlandı')).toBeVisible()
    expect(EventSourceConstructor).not.toHaveBeenCalled()
  })

  it('retries a paused AI filter on the same run', async () => {
    const pausedRun = {
      id: 'run-1', status: 'AWAITING_RETRY', currentStage: 'AI_FILTERING', targetDate: '2026-07-11',
      startedAt: '2026-07-11T04:00:00.000Z', completedAt: null, errorSummary: 'Gemini geçici olarak yoğun.',
      filter: { status: 'AWAITING_RETRY', counts: { in: 2, out: 1, pending: 1 }, retryAvailable: true, errorCategory: 'RATE_LIMITED', errorMessage: 'Gemini geçici olarak yoğun.' },
      counts: { editions: 1, documents: 4, assets: 0, completedItems: 3, totalItems: 4, failedItems: 0 },
      stages: [{ stage: 'AI_FILTERING', status: 'AWAITING_RETRY', completedItems: 3, totalItems: 4, failedItems: 0 }],
      editions: [],
    }
    const queuedRun = { ...pausedRun, status: 'QUEUED', errorSummary: null, filter: { ...pausedRun.filter, status: 'QUEUED', retryAvailable: false, errorMessage: null } }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(pausedRun), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ runId: 'run-1', status: 'QUEUED' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(queuedRun), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('EventSource', SilentEventSource)
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'AI filtresini tekrar dene' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/scan-runs/run-1/ai-filter/retry', expect.objectContaining({ method: 'POST' }))
    expect((await screen.findAllByText('Sırada'))[0]).toBeVisible()
  })

  it('retries only incomplete previous-source jobs on the same run', async () => {
    const pausedRun = {
      id: 'run-1', status: 'AWAITING_RETRY', currentStage: 'DISCOVERING_PREVIOUS_SOURCES', targetDate: '2026-07-11',
      startedAt: '2026-07-11T04:00:00.000Z', completedAt: null, errorSummary: 'Bir önceki kaynak işi geçici olarak başarısız oldu.',
      filter: { status: 'COMPLETED', counts: { in: 2, out: 1, pending: 0 }, retryAvailable: false, errorCategory: null, errorMessage: null },
      previousSources: { status: 'AWAITING_RETRY', counts: { total: 2, completed: 1, verified: 1, notRequired: 0, notFound: 0, ambiguous: 0, pending: 1 }, retryAvailable: true, errorMessage: 'Gemini geçici olarak yoğun.' },
      counts: { editions: 1, documents: 3, assets: 0, completedItems: 1, totalItems: 2, failedItems: 1 },
      stages: [{ stage: 'DISCOVERING_PREVIOUS_SOURCES', status: 'AWAITING_RETRY', completedItems: 1, totalItems: 2, failedItems: 1 }],
      editions: [],
    }
    const queuedRun = { ...pausedRun, status: 'QUEUED', errorSummary: null, previousSources: { ...pausedRun.previousSources, status: 'QUEUED', retryAvailable: false, errorMessage: null } }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(pausedRun), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ runId: 'run-1', status: 'QUEUED' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(queuedRun), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('EventSource', SilentEventSource)
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: 'Önceki kaynakları tekrar dene' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/scan-runs/run-1/previous-sources/retry', expect.objectContaining({ method: 'POST' }))
    expect((await screen.findAllByText('Sırada'))[0]).toBeVisible()
  })
})
