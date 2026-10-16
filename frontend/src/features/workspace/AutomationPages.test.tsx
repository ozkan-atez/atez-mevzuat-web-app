import { cleanup, fireEvent, render, screen, waitFor } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AutomationsPage, AutomationDetailPage } from './AutomationPages'

const automation = { id: 'a1', name: 'Hafta içi tarama', hour: 8, minute: 0, times: ['08:00','18:30'], weekdays: [1,5], timezone: 'Europe/Istanbul', sourceIds: ['rg'], groupIds: [], templateId: null, isActive: true, lastError: null, lastRunAt: null }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function mockApi(writes: Array<{ method: string; url: string; body: any }>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method) {
      writes.push({ method: options.method, url, body: options.body ? JSON.parse(String(options.body)) : null })
      return options.method === 'DELETE' ? new Response(null, { status: 204 }) : new Response(JSON.stringify(automation), { status: 201 })
    }
    if (url.includes('background-jobs')) return new Response(JSON.stringify({ broker: 'RabbitMQ', connected: true, jobs: [], total:0,counts:{RUNNING:0,RETRY:1,FAILED:0,COMPLETED:3},types:['atez-source-scan'], queues: [{ name: 'atez-source-scan', waiting: 2, retrying: 1, failed: 0, consumers: 1 }] }))
    if (url.includes('automations/a1?')) return new Response(JSON.stringify({ automation, runs: [{ id: 'run1', automationId: 'a1', trigger: 'CRON', targetDate: '2026-10-13', createdAt: '2026-10-13T05:00:00Z', status: 'FAILED', errorSummary: 'Kaynak yanıt vermedi', topicReports: [{ id: 'report1', title: 'Gümrük raporu', topicId: null, latestVersion: 2 }] }], total: 11 }))
    if (url.endsWith('automations')) return new Response(JSON.stringify({ automations: [automation] }))
    if (url.endsWith('sources')) return new Response(JSON.stringify({ sources: [{ id: 'rg', name: 'Resmî Gazete', isActive: true, scanSupported: true }] }))
    if (url.endsWith('templates')) return new Response(JSON.stringify({ templates: [], components: [] }))
    return new Response(JSON.stringify({ groups: [] }))
  }))
}
describe('Cron jobs', () => {
  it('shows all recurrence times and live RabbitMQ queue status', async () => {
    mockApi([])
    render(<MemoryRouter><AutomationsPage /></MemoryRouter>)
    expect(await screen.findByText('Pazartesi, Cuma · 08:00, 18:30 · Europe/Istanbul')).toBeVisible()
    expect(await screen.findByText('İşlem geçmişi')).toBeVisible()
    expect(screen.queryByText(/RabbitMQ/)).not.toBeInTheDocument()
    expect(screen.getByRole('combobox',{name:'İşlem türü'})).toBeVisible()
    expect(screen.getByRole('button',{name:/Tamamlandı/})).toHaveTextContent('3')

  })
  it('keeps history off the overview and opens reports and logs from management', async () => {
    mockApi([])
    render(<MemoryRouter initialEntries={['/automations']}><Routes><Route path="/automations" element={<AutomationsPage />} /><Route path="/automations/:id" element={<AutomationDetailPage />} /></Routes></MemoryRouter>)
    await screen.findByText('Hafta içi tarama')
    expect(screen.queryByText('Rapor ve çalışma geçmişi')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Geçmiş ve yönetim' }))
    expect(await screen.findByText('Rapor ve çalışma geçmişi')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Gümrük raporu · v2' })).toHaveAttribute('href', '/runs/run1/reports/report1')
    expect(screen.getByRole('link', { name: 'Logları ve ayrıntıları aç' })).toHaveAttribute('href', '/runs/run1')
    expect(screen.getByText('Kaynak yanıt vermedi')).toBeVisible()
    await userEvent.click(screen.getByTitle('2'))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/v1/automations/a1?page=2', expect.anything()))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Çalışma durumuna göre filtrele' }))
    await userEvent.click(await screen.findByText('Tamamlandı', { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/v1/automations/a1?page=1&status=COMPLETED', expect.anything()))
  })
  it('creates a cron job with chosen sources, multiple times and weekdays', async () => {
    const writes: any[] = []; mockApi(writes)
    render(<MemoryRouter><AutomationsPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: /Otomasyon oluştur/ }))
    await userEvent.type(screen.getByLabelText('Otomasyon adı'), 'Yeni cron')
    fireEvent.mouseDown(screen.getByLabelText('Taranacak kaynaklar'))
    await userEvent.click(await screen.findByText('Resmî Gazete', { selector: '.ant-select-item-option-content' }))
    fireEvent.mouseDown(screen.getByLabelText('Tekrar saatleri'))
    await userEvent.click(await screen.findByText('08:00', { selector: '.ant-select-item-option-content' }))
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(writes).toContainEqual({ method: 'POST', url: '/api/v1/automations', body: expect.objectContaining({ name: 'Yeni cron', sourceIds: ['rg'], times: ['04:00', '08:00'], weekdays: [1,2,3,4,5,6,7] }) }))
  })
  it('pauses and deletes an existing cron job', async () => {
    const writes: any[] = []; mockApi(writes)
    render(<MemoryRouter initialEntries={['/automations/a1']}><Routes><Route path="/automations/:id" element={<AutomationDetailPage />} /><Route path="/automations" element={<div>Kaldırıldı</div>} /></Routes></MemoryRouter>)
    await userEvent.click(await screen.findByRole('switch', { name: 'Otomasyonu etkinleştir' }))
    await waitFor(() => expect(writes).toContainEqual({ method: 'PATCH', url: '/api/v1/automations/a1', body: { isActive: false } }))
    await userEvent.click(screen.getByRole('button', { name: 'Otomasyonu kaldır' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Kaldır' }))
    expect(await screen.findByText('Kaldırıldı')).toBeVisible()
    expect(writes).toContainEqual({ method: 'DELETE', url: '/api/v1/automations/a1', body: null })
  })
  it('shows a useful error without an empty queue table when the monitor is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('background-jobs') ? new Response(JSON.stringify({ message: 'Route GET:/api/v1/background-jobs not found' }), { status: 404 }) : new Response(JSON.stringify({ automations: [], builtInSchedules: [], sources: [], templates: [], components: [], groups: [] }))))
    render(<MemoryRouter><AutomationsPage /></MemoryRouter>)
    expect(await screen.findByText('Arka plan izleme servisi bu sunucuda henüz etkin değil.')).toBeVisible()
    expect(screen.queryByText('Route GET:/api/v1/background-jobs not found')).not.toBeInTheDocument()
    expect(screen.queryByText('İş kuyruğu')).not.toBeInTheDocument()
  })

})
