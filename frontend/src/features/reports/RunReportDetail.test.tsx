import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunReportDetail } from './RunReportDetail'
import { ActiveReportProvider } from '../revision/ActiveReportContext'
import { DockedAiAssistant } from '../chat/DockedAiAssistant'

vi.mock('../revision/EditableReportPreview', () => ({
  clearLocalReportEdits: vi.fn(),
  readLocalReportEdits: vi.fn(() => ({})),
  EditableReportPreview: ({ html, onEditField }: { html: string; onEditField: (path: string, value: string) => void }) => (
    <div>
      <span>{html}</span>
      <button type="button" onClick={() => onEditField('emptyDayText', 'Düzeltilmiş bilgi metni')}>Bilgi metnini düzenle</button>
    </div>
  ),
}))

const initial = { title: 'Değişiklik yok raporu', version: 1, spec: { emptyDayText: 'Eski bilgi metni', source: { label: 'Resmî Gazete', url: 'https://example.test' } }, html: '<p>Eski bilgi metni</p>', reviewStatus: 'READY', draft: null }

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('RunReportDetail', () => {
  it('sends the docked assistant prompt to this report as a draft revision', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/review/prompt')) return new Response(JSON.stringify({
        version: 1, reviewStatus: 'PENDING_APPROVAL', edits: [{ path: 'emptyDayText', value: 'Kısaltılmış bilgi metni' }], html: '<p>Kısaltılmış bilgi metni</p>',
      }), { status: 200 })
      if (url.endsWith('/review') && init?.method === 'POST') return new Response(JSON.stringify({
        ...initial, version: 2, spec: { ...initial.spec, emptyDayText: 'Kısaltılmış bilgi metni' }, html: '<p>Kısaltılmış bilgi metni</p>',
      }), { status: 201 })
      return new Response(JSON.stringify(initial), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<MemoryRouter initialEntries={['/runs/run-1/reports/report-1']}><ActiveReportProvider>
      <Routes><Route path="/runs/:runId/reports/:reportId" element={<RunReportDetail />} /></Routes>
      <DockedAiAssistant isOpen onOpenChange={() => undefined} />
    </ActiveReportProvider></MemoryRouter>)

    await screen.findByText('Değişiklik yok raporu')
    await userEvent.type(await screen.findByPlaceholderText(/için revizyon isteyin/), 'Bilgi metnini kısalt{enter}')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/scan-runs/run-1/reports/report-1/review/prompt', expect.objectContaining({ method: 'POST' })))
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/v1/chat/'))).toBe(false)
    expect(await screen.findByText('<p>Kısaltılmış bilgi metni</p>')).toBeVisible()
    expect(screen.getByText('taslak')).toBeVisible()
    expect(screen.getByText('Gönderilemez · Revizyon onayı bekleniyor')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Onayla ve r02 oluştur' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/scan-runs/run-1/reports/report-1/review', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ expectedVersion: 1, edits: [{ path: 'emptyDayText', value: 'Kısaltılmış bilgi metni' }] }),
    }))
  })

  it('reviews and saves a direct edit as a new report revision', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response(JSON.stringify({ draft: { spec: { emptyDayText: 'Düzeltilmiş bilgi metni' }, html: '<p>Düzeltilmiş bilgi metni</p>' } }), { status: 200 })
      if (init?.method === 'POST') return new Response(JSON.stringify({ ...initial, version: 2, spec: { ...initial.spec, emptyDayText: 'Düzeltilmiş bilgi metni' }, html: '<p>Düzeltilmiş bilgi metni</p>' }), { status: 201 })
      return new Response(JSON.stringify(initial), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<MemoryRouter initialEntries={['/runs/run-1/reports/report-1']}><Routes><Route path="/runs/:runId/reports/:reportId" element={<RunReportDetail />} /></Routes></MemoryRouter>)

    expect(await screen.findByText('Değişiklik yok raporu')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Bülten Önizleme' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Bilgi metnini düzenle' }))
    expect(await screen.findByText('taslak')).toBeVisible()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/scan-runs/run-1/reports/report-1/review/draft', expect.objectContaining({ method: 'PUT' }))
    await userEvent.click(screen.getByRole('button', { name: 'Onayla ve r02 oluştur' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/scan-runs/run-1/reports/report-1/review', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ expectedVersion: 1, edits: [{ path: 'emptyDayText', value: 'Düzeltilmiş bilgi metni' }] }),
    }))
    await waitFor(() => expect(screen.getByText('<p>Düzeltilmiş bilgi metni</p>')).toBeVisible())
    await waitFor(() => expect(screen.queryByText('taslak')).not.toBeInTheDocument())
  })

  it('restores an unapproved revision after leaving and reopening the report', async () => {
    let pending = false
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        pending = true
        return new Response(JSON.stringify({ draft: { spec: { emptyDayText: 'Düzeltilmiş bilgi metni' }, html: '<p>Düzeltilmiş bilgi metni</p>' } }), { status: 200 })
      }
      return new Response(JSON.stringify(pending ? {
        ...initial, reviewStatus: 'PENDING_APPROVAL',
        draft: { baseVersion: 1, spec: { emptyDayText: 'Düzeltilmiş bilgi metni' }, html: '<p>Düzeltilmiş bilgi metni</p>' },
      } : initial), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const page = <MemoryRouter initialEntries={['/runs/run-1/reports/report-1']}><Routes><Route path="/runs/:runId/reports/:reportId" element={<RunReportDetail />} /></Routes></MemoryRouter>

    const first = render(page)
    await screen.findByText('Değişiklik yok raporu')
    await userEvent.click(screen.getByRole('button', { name: 'Bilgi metnini düzenle' }))
    expect(await screen.findByText('Gönderilemez · Revizyon onayı bekleniyor')).toBeVisible()
    first.unmount()

    render(page)
    expect(await screen.findByText('<p>Düzeltilmiş bilgi metni</p>')).toBeVisible()
    expect(screen.getByText('Gönderilemez · Revizyon onayı bekleniyor')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Onayla ve r02 oluştur' })).toBeEnabled()
  })
})
