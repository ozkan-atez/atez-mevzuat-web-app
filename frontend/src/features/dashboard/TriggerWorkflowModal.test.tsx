import { cleanup, render, screen, waitFor } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TriggerWorkflowModal } from './TriggerWorkflowModal'

const catalog = { sources: [
  { id: 'rg', key: 'resmi-gazete', name: 'Resmî Gazete', isActive: true, scanSupported: true },
  { id: 'trade', key: 'ticaret', name: 'Ticaret Bakanlığı', isActive: true, scanSupported: true },
  { id: 'pending', key: 'pending', name: 'Hazırlanan kaynak', isActive: true, scanSupported: false },
  { id: 'inactive', key: 'inactive', name: 'Pasif kaynak', isActive: false, scanSupported: true },
] }
function stubRequests(post: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input) === '/api/v1/sources'
    ? Promise.resolve(new Response(JSON.stringify(catalog))) : post(input, init)))
}
async function startScan() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Taramayı Başlat' })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: 'Taramayı Başlat' }))
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('TriggerWorkflowModal', () => {
  it('keeps the dialog open and shows the backend error', async () => {
    stubRequests(vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Nesne deposuna ulaşılamadı' }), { status: 503 })))
    const onTriggered = vi.fn(); const onClose = vi.fn()
    render(<TriggerWorkflowModal onClose={onClose} onTriggered={onTriggered} />)
    await startScan()
    expect(onTriggered).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Nesne deposuna ulaşılamadı')).toBeInTheDocument()
  })
  it('reuses the request key after a lost response instead of creating a second job', async () => {
    const post = vi.fn().mockRejectedValueOnce(new Error('Bağlantı kesildi')).mockResolvedValueOnce(new Response(JSON.stringify({ runId: 'same-run', status: 'QUEUED' }), { status: 202 }))
    stubRequests(post)
    const onClose = vi.fn(); const onTriggered = vi.fn()
    render(<TriggerWorkflowModal onClose={onClose} onTriggered={onTriggered} />)
    await startScan()
    await screen.findByText('Bağlantı kesildi')
    await startScan()
    expect(post.mock.calls[0]![1].headers['Idempotency-Key']).toBe(post.mock.calls[1]![1].headers['Idempotency-Key'])
    expect(onTriggered).toHaveBeenCalledWith('same-run'); expect(onClose).toHaveBeenCalledOnce()
  })
  it('sends only selected sources and prevents empty scans', async () => {
    const post = vi.fn().mockResolvedValue(new Response(JSON.stringify({ runId: 'selected-run' }), { status: 202 }))
    stubRequests(post)
    render(<TriggerWorkflowModal onClose={vi.fn()} />)
    const gazette = await screen.findByRole('button', { name: 'Resmî Gazete' })
    expect(gazette).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Hazırlanan kaynak/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Pasif kaynak/ })).toBeDisabled()
    await userEvent.click(gazette)
    expect(screen.getByRole('button', { name: 'Taramayı Başlat' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Ticaret Bakanlığı' }))
    await startScan()
    expect(JSON.parse(post.mock.calls[0]![1].body)).toMatchObject({ sourceKeys: ['ticaret'] })
  })
  it('uses a new request key when source selection changes after a failed request', async () => {
    const post = vi.fn().mockRejectedValue(new Error('Bağlantı kesildi'))
    stubRequests(post)
    render(<TriggerWorkflowModal onClose={vi.fn()} />)
    await startScan()
    await screen.findByText('Bağlantı kesildi')
    await userEvent.click(screen.getByRole('button', { name: 'Ticaret Bakanlığı' }))
    await startScan()
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    expect(post.mock.calls[0]![1].headers['Idempotency-Key']).not.toBe(post.mock.calls[1]![1].headers['Idempotency-Key'])
    expect(JSON.parse(post.mock.calls[1]![1].body).sourceKeys).toEqual(['resmi-gazete', 'ticaret'])
  })
  it('blocks scanning when sources fail to load and allows retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Kaynaklar alınamadı' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(catalog))))
    render(<TriggerWorkflowModal onClose={vi.fn()} />)
    await screen.findByText('Kaynaklar alınamadı')
    expect(screen.getByRole('button', { name: 'Taramayı Başlat' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Taramayı Başlat' })).toBeEnabled())
  })
})
