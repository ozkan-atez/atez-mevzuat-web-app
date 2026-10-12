import { cleanup, render, screen } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StandaloneReportDetail } from './StandaloneReportDetail'
import { ReportsIndex } from './ReportsIndex'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
describe('standalone report publication views',()=>{
  it('shows standalone reports alongside scan reports with its own route',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>new Response(JSON.stringify(String(input).includes('standalone-reports')?{reports:[{id:'standalone1',title:'Yüklenen belgeden rapor',latestVersion:2,operationTaskId:'root1',createdAt:'2026-10-11T10:00:00Z'}]}:{runs:[]}))))
    render(<MemoryRouter><ReportsIndex /></MemoryRouter>)
    expect(await screen.findByText('Yüklenen belgeden rapor')).toBeVisible()
    expect(screen.getByRole('link',{name:'İncele'})).toHaveAttribute('href','/reports/documents/standalone1')
  })
  it('loads each immutable published revision and keeps preview sandboxed',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input)
      return new Response(JSON.stringify(url.includes('/revisions/')?{reportId:'standalone1',version:url.endsWith('/1')?1:2,html:url.endsWith('/1')?'<h1>İlk sürüm</h1>':'<h1>İkinci sürüm</h1>'}:{id:'standalone1',title:'ATEZ belge raporu',latestVersion:2,operationTaskId:'root1',createdAt:'2026-10-11',revisions:[{version:2,operationTaskId:'task2',createdAt:'2026-10-11T10:00:00Z'},{version:1,operationTaskId:'task1',createdAt:'2026-10-10T10:00:00Z'}]}))
    }))
    render(<MemoryRouter initialEntries={['/reports/documents/standalone1']}><Routes><Route path="/reports/documents/:id" element={<StandaloneReportDetail />} /></Routes></MemoryRouter>)
    const iframe=await screen.findByTitle('Yayımlanmış belge raporu')
    expect(iframe).toHaveAttribute('sandbox','')
    expect(iframe).toHaveAttribute('srcdoc','<h1>İkinci sürüm</h1>')
    await userEvent.click(screen.getByLabelText('Rapor sürümü'))
    await userEvent.click(await screen.findByText(/Sürüm 1 ·/))
    expect(await screen.findByRole('link',{name:'Düzenleme ve işlem geçmişi'})).toHaveAttribute('href','/operations/task1')
  })
})
