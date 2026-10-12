import { cleanup, render, screen, waitFor } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManagedSourcesPanel, ReportSourceImport } from './ManagedSourcesPanel'
function LocationProbe() { const location = useLocation(); return <span data-testid="location">{location.pathname}{location.search}</span> }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('ManagedSourcesPanel', () => {
  it('creates a real active source with the selected usage settings', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => Promise.resolve(new Response(JSON.stringify(init?.method === 'POST' ? { id: 's1' } : { sources: [] }), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    render(<MemoryRouter><ManagedSourcesPanel /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: 'Kaynak ekle' }))
    await userEvent.type(screen.getByLabelText('Kaynak adı'), 'Ticaret Bakanlığı')
    await userEvent.type(screen.getByLabelText('Kaynak bağlantısı'), 'https://ticaret.gov.tr')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/managed-sources', expect.objectContaining({ method: 'POST', body: expect.stringContaining('"useInChat":true') })))
    const body = JSON.parse(fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')![1].body)
    expect(body).toMatchObject({ title: 'Ticaret Bakanlığı', url: 'https://ticaret.gov.tr', useInRuns: true, isActive: true })
  })
  it('imports stored source evidence into a real report draft then opens its chat', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url.endsWith('/sessions') ? { sessions: [{ id: 'thread-1', type: 'REPORT_REVISION', title: 'İthalat raporu', target: '/reports/topic-1' }] } : { html: '' }), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    const close = vi.fn()
    render(<MemoryRouter><ReportSourceImport source={{ title: 'Yeni mevzuat', url: 'https://ticaret.gov.tr', contentText: 'Resmî kaynakta açıklanan değişiklik.' }} onClose={close} /><LocationProbe /></MemoryRouter>)
    await userEvent.click(screen.getByRole('combobox', { name: 'Hedef rapor' }))
    await userEvent.click(await screen.findByText('İthalat raporu'))
    await userEvent.click(screen.getByRole('button', { name: 'Taslağa ekle ve raporu aç' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/topics/topic-1/draft/sources', expect.objectContaining({ method: 'POST', body: expect.stringContaining('Resmî kaynakta açıklanan değişiklik.') })))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/chat?topic=topic-1'))
    expect(close).toHaveBeenCalledOnce()
  })
})
