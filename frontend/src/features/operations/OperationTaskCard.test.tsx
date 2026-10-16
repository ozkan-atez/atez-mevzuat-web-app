import { cleanup, render, screen, waitFor } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OperationTaskCard } from './OperationTaskCard'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('OperationTaskCard', () => {
  it('shows independent saved report links and no legacy revision controls', async () => {
    const tasks=[1,2].map(i=>({id:`publish${i}`,operation:'PUBLISH_REPORT',status:'SUCCEEDED',artifacts:[{kind:'PUBLISHED_REPORT',data:{reportId:`r${i}`,title:`Rapor ${i}`}}]}))
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({id:'op',operation:'BUILD_REPORT',status:'SUCCEEDED',tasks}),{status:200})))
    render(<MemoryRouter><OperationTaskCard requestId="op" /></MemoryRouter>)
    expect(await screen.findByRole('link',{name:'Rapor 1'})).toHaveAttribute('href','/reports/documents/r1')
    expect(screen.getByRole('link',{name:'Rapor 2'})).toHaveAttribute('href','/reports/documents/r2')
    expect(screen.getByText('2 / 2 rapor Raporlar’a kaydedildi.')).toBeTruthy()
    expect(screen.queryByRole('button',{name:'Taslak içeriğini düzenle'})).toBeNull()
    expect(screen.queryByRole('button',{name:'Analizi düzelt'})).toBeNull()
  })
  it('renders the frozen draft in a sandbox without exposing the legacy editor',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({id:'op',operation:'BUILD_REPORT',status:'SUCCEEDED',tasks:[{id:'draft',operation:'BUILD_REPORT',status:'SUCCEEDED',artifacts:[{kind:'REPORT_DRAFT',data:{title:'ATEZ taslağı',html:'<h1>ATEZ</h1>'}}]}]}),{status:200})))
    render(<MemoryRouter><OperationTaskCard requestId="op" /></MemoryRouter>)
    expect(await screen.findByTitle('ATEZ taslağı')).toHaveAttribute('sandbox','')
    expect(screen.queryByRole('button',{name:'Taslak içeriğini düzenle'})).toBeNull()
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
