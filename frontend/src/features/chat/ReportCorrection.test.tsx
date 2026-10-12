import { cleanup, fireEvent, render, screen, waitFor } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfigProvider } from 'antd'
import { ChatScreen } from './ChatScreen'
vi.mock('../revision/ReportWorkspace', () => ({ ReportWorkspace: ({ topicId, popup }: { topicId: string; popup: boolean }) => <div data-testid="correction-workspace">{topicId} · {popup ? 'popup' : 'legacy'}</div> }))
function Location() { const location = useLocation(); return <output data-testid="location">{location.pathname}{location.search}</output> }
function setup(path: string, withReportLink = false) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/chat/reports')) return new Response(JSON.stringify({ reports: [{ topicId: 'published', title: '–– Yayımlanmış rapor', version: 2, gazetteDate: '2026-10-09' }] }))
    if (url.endsWith('/topics/missing')) return new Response(JSON.stringify({ reportVersion: null }))
    if (url.endsWith('/topics/published')) return new Response(JSON.stringify({ reportVersion: 2 }))
    if (url.endsWith('/messages')) return new Response(JSON.stringify({ messages: [{ id: 'u1', role: withReportLink ? 'ASSISTANT' : 'USER', content: withReportLink ? '[Bülteni aç](/reports/published?revision=2)' : 'Mevcut sohbet', status: 'COMPLETED', createdAt: '2026-10-09T07:00:00Z', errorDetail: null }] }))
    return new Response(JSON.stringify({ sessions: [] }))
  })
  vi.stubGlobal('fetch', fetchMock)
  render(<ConfigProvider theme={{ token: { motion: false } }}><MemoryRouter initialEntries={[path]}><Routes><Route path="/chat" element={<><ChatScreen /><Location /></>} /><Route path="/chat/:sessionId" element={<><ChatScreen /><Location /></>} /></Routes></MemoryRouter></ConfigProvider>)
  return fetchMock
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('report corrections stay beside the conversation', () => {
  it('recovers a legacy link without a bulletin and leaves the composer available', async () => {
    const fetchMock = setup('/chat?topic=missing')
    expect(await screen.findByText(/Bu belge için henüz yayımlanmış bir bülten yok/)).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Mesaj' })).toBeVisible()
    expect(screen.queryByText('Bülten kaydı bulunamadı')).not.toBeInTheDocument()
    expect(screen.queryByTestId('correction-workspace')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/chat$/))
    expect(fetchMock.mock.calls.every(call => !call[0].toString().includes('/draft'))).toBe(true)
  })
  it('opens a published report in the popup without creating or switching conversations', async () => {
    const fetchMock = setup('/chat/session-1')
    expect(await screen.findByText('Mevcut sohbet')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: /Rapor düzelt/ }))
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Düzeltilecek rapor' }))
    await userEvent.click(await screen.findByText('Yayımlanmış rapor · r2 · 2026-10-09'))
    expect(await screen.findByTestId('correction-workspace')).toHaveTextContent('published · popup')
    expect(screen.getByText('Mevcut sohbet')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/chat/session-1?topic=published')
    expect(fetchMock.mock.calls.filter(call => String(call[0]) === '/api/v1/chat/sessions')).toHaveLength(1)
  })
  it('opens a report link from a message while keeping the current conversation', async () => {
    setup('/chat/session-1', true)
    await userEvent.click(await screen.findByRole('link', { name: 'Bülteni aç' }))
    expect(await screen.findByTestId('correction-workspace')).toHaveTextContent('published · popup')
    expect(screen.getByTestId('location')).toHaveTextContent('/chat/session-1?topic=published&revision=2')
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/chat\/session-1$/))
    expect(screen.getByRole('textbox', { name: 'Mesaj' })).toBeVisible()
  })

})
