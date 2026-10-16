import { cleanup, fireEvent, render, screen, waitFor } from '../../test/test-utils'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsagePage, usageTimestamp } from './UsagePage'
import * as api from './api'
import type { UsageSummary } from './api'

const sample: UsageSummary = {
  page: 1, pageSize: 20, total: 1, from: '2026-10-13', to: '2026-10-13', teamAccess: true,
  users: [{id: 'ayse', name: 'Ayşe Yılmaz', email: 'ayse@example.test'}],
  summary: {inputTokens: 100, outputTokens: 10, totalTokens: 115, callCount: 1, noModelCount: 0, unmeasuredCount: 1, conversationCount: 1},
  rows: [{conversationId: 's1', conversationType: 'GENERAL', title: 'İthalat araştırması', target: '/chat/s1', firstAt: '2026-10-13T07:12:30', lastAt: '2026-10-13T07:12:30', messageCount: 2, models: ['gemini-test'], users: [{id: 'ayse', name: 'Ayşe Yılmaz', email: 'ayse@example.test'}], inputTokens: 100, outputTokens: 10, totalTokens: 115, callCount: 1, noModelCount: 0, unmeasuredCount: 1}],
}
afterEach(() => {cleanup(); vi.restoreAllMocks()})
describe('conversation usage page', () => {
  it('shows identity, Istanbul timestamps, partial measurement, and real call details', async () => {
    vi.spyOn(api, 'getUsage').mockResolvedValue(sample)
    const details = vi.spyOn(api, 'getUsageDetails').mockResolvedValue({page: 1, pageSize: 50, total: 1, rows: [{id: 'call1', messageId: 'm1', actorUserId: 'ayse', userName: 'Ayşe Yılmaz', userEmail: 'ayse@example.test', model: 'gemini-test', provider: 'gemini', mode: 'WEB', status: 'CANCELLED', startedAt: '2026-10-13T07:12:30Z', completedAt: '2026-10-13T07:12:32Z', inputTokens: 100, outputTokens: 10, totalTokens: null, cachedTokens: null, reasoningTokens: null}]})
    render(<MemoryRouter><UsagePage /></MemoryRouter>)
    expect(await screen.findByText('İthalat araştırması')).toBeVisible()
    expect(screen.getByText('ayse@example.test')).toBeVisible()
    expect(screen.getByText('13.10.2026 10:12:30')).toBeVisible()
    expect(screen.getByText(/1 çağrıda ölçüm kısmi veya eksik/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', {name: 'İthalat araştırması çağrı ayrıntıları'}))
    expect(await screen.findByText('Durduruldu')).toBeVisible()
    expect(screen.getAllByText('Kısmi ölçüm').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', {name: /İlgili kaydı aç/})).toHaveAttribute('href', '/chat/s1')
    expect(details).toHaveBeenCalledWith(expect.objectContaining({conversationId: 's1', type: 'GENERAL', page: 1}))
  })
  it('applies a date range and title filter on the server', async () => {
    const load = vi.spyOn(api, 'getUsage').mockResolvedValue({...sample, teamAccess: false})
    render(<MemoryRouter><UsagePage /></MemoryRouter>)
    await screen.findByText('İthalat araştırması')
    expect(screen.queryByLabelText('Kullanıcı')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name:'Filtreler'}))
    fireEvent.change(screen.getByLabelText('Başlangıç tarihi'), {target: {value: '2026-09-01'}})
    fireEvent.change(screen.getByLabelText('Bitiş tarihi'), {target: {value: '2026-09-30'}})
    fireEvent.change(screen.getByLabelText('İşlem ara'), {target: {value: 'ithalat'}})
    fireEvent.click(screen.getByRole('button', {name: 'Uygula'}))
    await waitFor(() => expect(load).toHaveBeenLastCalledWith(expect.objectContaining({from: '2026-09-01', to: '2026-09-30', query: 'ithalat', page: 1})))
  })
  it('offers retry when usage cannot be loaded', async () => {
    const load = vi.spyOn(api, 'getUsage').mockRejectedValueOnce(new Error('Bağlantı kurulamadı.')).mockResolvedValue(sample)
    render(<MemoryRouter><UsagePage /></MemoryRouter>)
    expect(await screen.findByText('Bağlantı kurulamadı.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', {name: 'Yeniden dene'}))
    expect(await screen.findByText('İthalat araştırması')).toBeVisible()
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('formats UTC and PostgreSQL timestamp strings identically', () => {
    expect(usageTimestamp('2026-10-12T21:00:00')).toBe('13.10.2026 00:00:00')
    expect(usageTimestamp('2026-10-12T21:00:00Z')).toBe('13.10.2026 00:00:00')
  })
})
