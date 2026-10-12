import { cleanup, render, screen, waitFor } from '../../test/test-utils'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DayActivity } from './DayActivity'

const empty = { items: [], hasMore: false, summary: { reports: 0, revisions: 0, chats: 0, scans: 0 }, latestReport: null }
const mount = () => render(<MemoryRouter><DayActivity schedule={null} /></MemoryRouter>)
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('day activity card', () => {
  it('shows an older latest report with its actual date even on an empty day', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...empty, latestReport: { id: 'r', title: 'Son gümrük raporu', version: 3, at: '2026-10-01T10:00:00Z', href: '/reports/r' } }))))
    mount()
    expect(await screen.findByText('Bugün henüz hareket yok.')).toBeVisible()
    expect(screen.getByRole('link', { name: /Son gümrük raporu/ })).toHaveAttribute('href', '/reports/r')
    expect(screen.getByText(/1 Eki/)).toBeVisible()
    expect(screen.getByText('v3')).toBeVisible()
  })
  it('fetches selected periods and types and exposes actionable revision entries', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ...empty, items: [{ id: 'v2', kind: 'REVISION', title: 'İthalat raporu', detail: 'Kaynaklar güncellendi', at: '2026-10-12T08:00:00Z', href: '/reports/topic', version: 2 }] })))
    vi.stubGlobal('fetch', fetcher)
    mount()
    expect(await screen.findByRole('link', { name: /Kaynaklar güncellendi/ })).toHaveAttribute('href', '/reports/topic')
    await userEvent.click(screen.getByRole('combobox', { name: 'Akış dönemi' }))
    await userEvent.click(screen.getByText('Son 7 gün'))
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/v1/workspace/activity?days=7', expect.anything()))
    await userEvent.click(screen.getByRole('combobox', { name: 'Hareket türü' }))
    await userEvent.click(screen.getByText('Revizyonlar'))
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/v1/workspace/activity?days=7&kind=REVISION', expect.anything()))
  })
  it('shows a recoverable error instead of an empty-day claim', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 })).mockImplementation(async () => new Response(JSON.stringify(empty)))
    vi.stubGlobal('fetch', fetcher)
    mount()
    expect(await screen.findByText('Günün akışı alınamadı. Yeniden deneyebilirsiniz.')).toBeVisible()
    expect(screen.queryByText('Bugün henüz hareket yok.')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Günün akışını yenile' }))
    expect(await screen.findByText('Bugün henüz hareket yok.')).toBeVisible()
  })
})
