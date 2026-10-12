import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { cleanup, render, screen, waitFor } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReportsIndex } from './ReportsIndex'
vi.mock('../revision/ReportWorkspace', () => ({ ReportWorkspace: ({ topicId }: { topicId: string }) => <div data-testid="report-editor">{topicId}</div> }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const rows = [
  { id: 'report-1', runId: 'run-1', topicId: 'topic-1', title: 'İthalat Tebliği', version: 2, targetDate: '2026-09-15', origin: 'AUTOMATION', contentType: 'LEGISLATION', automationName: 'Günlük mevzuat', sources: [] },
  { id: 'report-2', runId: 'run-1', topicId: null, title: 'Değişiklik yok bülteni', version: 1, targetDate: '2026-09-15', origin: 'MANUAL', contentType: 'NO_CHANGE', initiatedBy: { id: 'u1', name: 'Ayşe' }, sources: [] },
]
function stub() {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const query = new URL(String(input), 'http://localhost').searchParams
    const filtered = rows.filter(row => (!query.get('query') || row.title.includes(query.get('query')!)) && (query.get('origin') === 'ALL' || row.origin === query.get('origin')))
    return new Response(JSON.stringify({ reports: filtered, total: filtered.length }))
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
function ChatProbe() { const location = useLocation(); return <div>Sohbet: {location.state?.scanIntent ? 'kaynak seçimi' : 'genel'}</div> }
describe('ReportsIndex', () => {
  it('opens chat source selection without creating a scan or session', async () => {
    const fetcher = stub()
    render(<MemoryRouter initialEntries={['/reports']}><Routes><Route path="/reports" element={<ReportsIndex />} /><Route path="/chat" element={<ChatProbe />} /></Routes></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: /Yeni tarama başlat/ }))
    expect(await screen.findByText('Sohbet: kaynak seçimi')).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fetcher.mock.calls.every(([url]) => String(url).startsWith('/api/v1/reports?'))).toBe(true)
  })
  it('separates production origin from content and filters on the server', async () => {
    const fetcher = stub()
    render(<MemoryRouter><ReportsIndex /></MemoryRouter>)
    expect(await screen.findByText('İthalat Tebliği')).toBeVisible()
    expect(screen.getByText('Değişiklik yok bülteni')).toBeVisible()
    expect(screen.getByText('Günlük mevzuat')).toBeVisible()
    await userEvent.click(screen.getAllByRole('button', { name: 'Revize et' })[1]!)
    expect(await screen.findByTestId('report-editor')).toHaveTextContent('report-2')
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Raporlarda ara' }), 'İthalat')
    await waitFor(() => expect(screen.queryByText('Değişiklik yok bülteni')).not.toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'İncele' })).toHaveAttribute('href', '/reports/topic-1')
    expect(fetcher.mock.calls.some(([url]) => new URL(String(url), 'http://localhost').searchParams.get('query') === 'İthalat')).toBe(true)
  })
})
