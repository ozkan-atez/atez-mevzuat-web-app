import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReportDetail } from './ReportDetail'

const topic = {
  id: 'topic-1', runId: 'run-1', documentId: 'doc-1', title: 'İthalat Tebliği', sourceUrl: 'https://example.test/current', status: 'COMPLETED',
  retryAvailable: false, errorCategory: null, errorMessage: null, analysisVersion: 1, reportVersion: 2, reportCard: 'K1', reportBasename: 'ithalat-tebligi.html',
  latestAnalysis: { id: 'analysis-1', version: 1, status: 'COMPLETED', createdAt: '2026-09-11T05:00:00Z' },
  latestReport: { id: 'report-1', version: 2, card: 'K1', basename: 'ithalat-tebligi.html', createdAt: '2026-09-11T05:00:00Z' },
  analyses: [], reports: [], thread: { id: 'thread-1', messages: [] },
}

describe('ReportDetail', () => {
  it('loads the real topic report', async () => {
    const delivery = {
      topicId: 'topic-1', reportVersion: 2, targetDate: '2026-09-11',
      sources: [{ kind: 'GAZETTE', label: 'Resmî Gazete — İthalat Tebliği', url: 'https://example.test/current' }],
      draft: { subject: 'konu', bodyHtml: '<p>gövde</p>', summary: 'özet', attachmentName: 'bulten.pdf' },
      sender: { configured: false }, groups: [], dispatches: [],
    }
    const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve(
      url.endsWith('/reports/2/html')
        ? new Response('<!doctype html><html><body>Gerçek bülten</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
        : new Response(JSON.stringify(url.endsWith('/delivery') ? delivery : topic), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ))
    vi.stubGlobal('fetch', fetchMock)

    render(<MemoryRouter initialEntries={['/reports/topic-1?revision=2']}><Routes><Route path="/reports/:id" element={<ReportDetail />} /></Routes></MemoryRouter>)

    expect(await screen.findByText('İthalat Tebliği')).toBeVisible()
    expect(screen.getByTitle('Bülten Önizleme')).toHaveAttribute('srcdoc', expect.stringContaining('Gerçek bülten'))
    expect(screen.queryByText('Revizyon & Sohbet')).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/topics/topic-1/reports/2/html')
    expect(await screen.findByRole('link', { name: /Resmî Gazete/ })).toHaveAttribute('href', 'https://example.test/current')
    expect(screen.getByRole('button', { name: 'PDF İndir' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'E-Posta ile Dağıt' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Yakınlaştır' })).toBeVisible()
    expect(document.body.textContent).not.toContain('İthalatta Haksız Rekabetin Önlenmesine İlişkin Tebliğ (No: 2026/4)')
  })

  it('shows a real error instead of demo content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))
    render(<MemoryRouter initialEntries={['/reports/missing']}><Routes><Route path="/reports/:id" element={<ReportDetail />} /></Routes></MemoryRouter>)
    expect(await screen.findByText('Bülten kaydı bulunamadı')).toBeVisible()
  })
})
