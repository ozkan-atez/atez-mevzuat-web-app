import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { cleanup, render, screen, waitFor } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReportsIndex } from './ReportsIndex'

vi.mock('../revision/ReportWorkspace', () => ({ReportWorkspace: ({topicId}:{topicId:string}) => <div data-testid="report-editor">{topicId}</div>}))

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ReportsIndex', () => {
  it('preserves automation provenance even when the automation was started manually',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input)
      if(url.includes('standalone-reports'))return new Response(JSON.stringify({reports:[]}))
      if(url.includes('scan-runs?'))return new Response(JSON.stringify({runs:[{id:'run-auto',trigger:'MANUAL',automationId:'daily',automationName:'Günlük gümrük takibi'}]}))
      return new Response(JSON.stringify({id:'run-auto',targetDate:'2026-10-14',reports:[{id:'r',title:'Günlük bülten',version:1,card:'K6',topicId:null}]}))
    }))
    render(<MemoryRouter><ReportsIndex/></MemoryRouter>)
    await screen.findByText('Günlük bülten')
    expect(screen.getByText(/Otomasyon.*Günlük gümrük takibi/)).toBeVisible()
    await userEvent.type(screen.getByRole('searchbox',{name:'Raporlarda ara'}),'Günlük gümrük takibi')
    expect(screen.getByText('Günlük bülten')).toBeVisible()
  })
  it('opens chat without starting a scan', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(String(input).includes('standalone-reports') ? {reports: []} : {runs: []})))
    vi.stubGlobal('fetch', fetcher)
    render(<MemoryRouter initialEntries={['/reports']}><Routes>
      <Route path="/reports" element={<ReportsIndex />} />
      <Route path="/chat" element={<div>Sohbet ekranı</div>} />
    </Routes></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', {name: /Yeni tarama başlat/}))
    expect(await screen.findByText('Sohbet ekranı')).toBeVisible()
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })
  it('shows a newly generated historical report ahead of older reports for current dates', async () => {
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input)
      if(url.includes('standalone-reports'))return new Response(JSON.stringify({reports:[]}))
      if(url.includes('scan-runs?'))return new Response(JSON.stringify({runs:[{id:'historical'},{id:'today'}]}))
      return new Response(JSON.stringify(url.endsWith('/historical')?{id:'historical',targetDate:'2026-07-31',reports:[{id:'new-report',topicId:'t1',title:'Yeni oluşturulan eski tarihli rapor',version:1,card:'K2',publishedAt:'2026-10-12T10:43:00Z'}]}:{id:'today',targetDate:'2026-10-12',reports:[{id:'old-report',topicId:null,title:'Sabah oluşturulan günlük rapor',version:1,card:'K6',publishedAt:'2026-10-12T05:00:00Z'}]}))
    }))
    render(<MemoryRouter><ReportsIndex/></MemoryRouter>)
    await screen.findByText('Yeni oluşturulan eski tarihli rapor')
    const rows=screen.getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Yeni oluşturulan eski tarihli rapor')
    expect(rows[2]).toHaveTextContent('Sabah oluşturulan günlük rapor')
  })

  it('lists reports from real scan responses and filters by report type', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('scan-runs?')) return new Response(JSON.stringify({ runs: [{ id: 'run-1' }] }))
      if (url.endsWith('/run-1')) return new Response(JSON.stringify({
        id: 'run-1', targetDate: '2026-09-15', reports: [
          { id: 'report-1', topicId: 'topic-1', title: 'İthalat Tebliği', version: 2, card: 'K2' },
          { id: 'report-2', topicId: null, title: 'Değişiklik yok bülteni', version: 1, card: 'K6' },
        ],
      }))
      return new Response(null, { status: 404 })
    }))

    render(<MemoryRouter><ReportsIndex /></MemoryRouter>)
    expect(await screen.findByText('İthalat Tebliği')).toBeVisible()
    expect(screen.getByText('Değişiklik yok bülteni')).toBeVisible()
    expect(screen.getAllByRole('link', { name: 'İncele' })).toHaveLength(2)

    await userEvent.click(screen.getAllByRole('button', {name:'Revize et'})[1]!)
    expect(await screen.findByTestId('report-editor')).toHaveTextContent('report-2')
    await userEvent.click(screen.getByRole('button', {name:'Close'}))

    await userEvent.type(screen.getByRole('searchbox', { name: 'Raporlarda ara' }), 'İthalat')
    await waitFor(() => expect(screen.queryByText('Değişiklik yok bülteni')).not.toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'İncele' })).toHaveAttribute('href', '/reports/topic-1')
  })
})
