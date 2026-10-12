import { cleanup, render, screen, waitFor } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OperationTaskCard } from './OperationTaskCard'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('OperationTaskCard', () => {
  it('builds a separate draft from successful analysis and renders it sandboxed', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => new Response(JSON.stringify(url.endsWith('/operations') && init?.method === 'POST' ? { id: 'draft1' } : url.endsWith('/draft1') ? { id: 'draft1', status: 'SUCCEEDED', operation: 'BUILD_REPORT', mode: 'FILL_MISSING', tasks: [{ id: 'task2', operation: 'BUILD_REPORT', status: 'SUCCEEDED', reused: false, artifacts: [{ kind: 'REPORT_DRAFT', data: { title: 'ATEZ taslağı', html: '<h1>ATEZ</h1><script>bad()</script>' } }] }] } : { id: 'analysis1', status: 'SUCCEEDED', operation: 'ANALYZE', mode: 'FILL_MISSING', tasks: [{ id: 'task1', operation: 'ANALYZE', status: 'SUCCEEDED', reused: false, artifacts: [] }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    render(<MemoryRouter><OperationTaskCard requestId="analysis1" /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: 'Rapor taslağı oluştur' }))
    const iframe = await screen.findByTitle('ATEZ taslağı')
    expect(iframe.getAttribute('sandbox')).toBe('')
    const post = fetcher.mock.calls.find(call => call[1]?.method === 'POST')!
    expect(JSON.parse(String(post[1]!.body))).toEqual({ operation: 'BUILD_REPORT', mode: 'FILL_MISSING', documentVersionIds: [], analysisTaskId: 'task1' })
  })
  it('edits a draft through deterministic content fields while preserving the original', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ id: 'draft1', status: 'SUCCEEDED', operation: 'BUILD_REPORT', mode: 'FILL_MISSING', tasks: [{ id: 'draft-task', status: 'SUCCEEDED', operation: 'BUILD_REPORT', reused: false, artifacts: [{ kind: 'REPORT_DRAFT', data: { title: 'Eski başlık', html: '<p>Özet</p>', reportContent: { title: 'Eski başlık', summary: 'Özet', detailedAnalysis: 'Ayrıntılar' } } }] }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    render(<MemoryRouter><OperationTaskCard requestId="draft1" /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: 'Taslak içeriğini düzenle' }))
    expect(screen.getByLabelText('Taslak özeti')).toHaveValue('Özet')
    await userEvent.clear(screen.getByLabelText('Taslak başlığı'))
    await userEvent.type(screen.getByLabelText('Taslak başlığı'), 'Yeni başlık')
    await userEvent.click(screen.getByRole('button', { name: 'Yeni taslak sürümünü kaydet' }))
    await waitFor(() => expect(fetcher.mock.calls.some(call => call[1]?.method === 'POST')).toBe(true))
    const post = fetcher.mock.calls.find(call => call[1]?.method === 'POST')!
    expect(JSON.parse(String(post[1]!.body))).toEqual({ operation: 'REVISE_REPORT', mode: 'FORCE', documentVersionIds: [], reportTaskId: 'draft-task', reportEdits: { title: 'Yeni başlık', summary: 'Özet', detailedAnalysis: 'Ayrıntılar' } })
  })
  it('retains server failure details and retries only that task', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ id: 'op1', status: 'FAILED', operation: 'ANALYZE', mode: 'FORCE', tasks: [{ id: 'task1', operation: 'ANALYZE', status: 'FAILED', reused: false, errorMessage: 'Yapay zekâ bağlantısı kurulamadı.', artifacts: [] }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    render(<MemoryRouter><OperationTaskCard requestId="op1" /></MemoryRouter>)
    expect(await screen.findByText('Yapay zekâ bağlantısı kurulamadı.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Adımı yeniden dene' }))
    await waitFor(() => expect(fetcher.mock.calls.some(call => call[0] === '/api/v1/operation-tasks/task1/retry' && call[1]?.method === 'POST')).toBe(true))
  })
})
