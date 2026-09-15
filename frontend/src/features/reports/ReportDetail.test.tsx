import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReportDetail } from './ReportDetail'
import { ActiveReportProvider } from '../revision/ActiveReportContext'

const topic = {
  id: 'topic-1', runId: 'run-1', documentId: 'doc-1', title: 'İthalat Tebliği', sourceUrl: 'https://example.test/current', status: 'COMPLETED',
  retryAvailable: false, errorCategory: null, errorMessage: null, analysisVersion: 1, reportVersion: 2, reportCard: 'K1', reportBasename: 'ithalat.html',
  latestAnalysis: { id: 'analysis-1', version: 1, status: 'COMPLETED', createdAt: '2026-09-11T05:00:00Z' },
  latestReport: { id: 'report-1', version: 2, card: 'K1', basename: 'ithalat.html', createdAt: '2026-09-11T05:00:00Z' },
  analyses: [], reports: [], thread: { id: 'thread-1', messages: [] },
}

const delivery = {
  topicId: 'topic-1', reportVersion: 2, targetDate: '2026-09-11',
  sources: [{ kind: 'GAZETTE', label: 'Resmî Gazete — İthalat Tebliği', url: 'https://example.test/current' }],
  draft: { subject: 'konu', bodyText: 'gövde', attachmentName: 'bulten.pdf' },
  sender: { configured: false }, groups: [], dispatches: [],
}

const previewHtml = '<!doctype html><html><body><h1 data-field="title">İthalat Tebliğinde Değişiklik</h1></body></html>'

function draftPayload(edits: unknown[] = []) {
  return {
    draft: edits.length ? { id: 'draft-1', status: 'OPEN', updatedAt: '2026-09-11T06:00:00Z', edits } : null,
    baseVersion: 2,
    publishedVersion: 2,
    isStale: false,
    spec: { title: 'İthalat Tebliğinde Değişiklik' },
    html: previewHtml,
  }
}

function staleDraftPayload() {
  return { ...draftPayload([
    { id: 'edit-1', sequence: 1, path: 'title', previousValue: 'Eski', nextValue: 'Yeni', source: 'USER', prompt: null, chatMessageId: null, revertsEditId: null, revertedByEditId: null, createdAt: '2026-09-11T06:00:00Z' },
  ]), publishedVersion: 3, isStale: true }
}

function stubFetch(handlers: { draft?: unknown } = {}) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const body = url.endsWith('/draft')
      ? handlers.draft ?? draftPayload()
      : url.endsWith('/delivery') ? delivery : topic
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/reports/topic-1']}>
      <ActiveReportProvider>
        <Routes><Route path="/reports/:id" element={<ReportDetail />} /></Routes>
      </ActiveReportProvider>
    </MemoryRouter>,
  )
}

describe('ReportDetail', () => {
  afterEach(cleanup)

  it('renders the published bulletin with its sources and actions', async () => {
    stubFetch()

    renderPage()

    expect(await screen.findByText('İthalat Tebliği')).toBeVisible()
    expect(screen.getByTitle('Bülten Önizleme')).toHaveAttribute('srcdoc', expect.stringContaining('data-field="title"'))
    expect(await screen.findByRole('link', { name: /Resmî Gazete/ })).toHaveAttribute('href', 'https://example.test/current')
    expect(screen.getByRole('button', { name: 'PDF İndir' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'E-Posta ile Dağıt' })).toBeVisible()
  })

  it('lets the preview drive editing without letting the document run scripts', async () => {
    stubFetch()

    renderPage()

    const frame = await screen.findByTitle('Bülten Önizleme')
    // Same-origin gives the parent DOM access; no allow-scripts keeps the document inert.
    expect(frame).toHaveAttribute('sandbox', 'allow-same-origin')
  })

  it('numbers the accumulated changes and opens a summary on click', async () => {
    stubFetch({
      draft: draftPayload([
        { id: 'edit-1', sequence: 1, path: 'title', previousValue: 'Eski', nextValue: 'Yeni', source: 'USER', prompt: null, chatMessageId: null, revertsEditId: null, revertedByEditId: null, createdAt: '2026-09-11T06:00:00Z' },
        { id: 'edit-2', sequence: 2, path: 'summary', previousValue: 'Eski özet', nextValue: 'Yeni özet', source: 'AI', prompt: 'özeti sadeleştir', chatMessageId: 'msg-1', revertsEditId: null, revertedByEditId: null, createdAt: '2026-09-11T06:01:00Z' },
      ]),
    })

    renderPage()

    expect(await screen.findByText('Başlık')).toBeVisible()
    expect(screen.getByText('Kısa özet')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: /Kısa özet/ }))
    expect(screen.getByText('Yeni özet')).toBeVisible()
    expect(screen.getByText('özeti sadeleştir')).toBeVisible()
  })

  it('offers publishing only while changes are pending', async () => {
    stubFetch()
    const { unmount } = renderPage()
    expect(await screen.findByText('İthalat Tebliği')).toBeVisible()
    expect(screen.queryByRole('button', { name: /Onayla ve r03 oluştur/ })).toBeNull()
    unmount()

    stubFetch({
      draft: draftPayload([
        { id: 'edit-1', sequence: 1, path: 'title', previousValue: 'Eski', nextValue: 'Yeni', source: 'USER', prompt: null, chatMessageId: null, revertsEditId: null, revertedByEditId: null, createdAt: '2026-09-11T06:00:00Z' },
      ]),
    })
    renderPage()

    expect(await screen.findByRole('button', { name: /Onayla ve r03 oluştur/ })).toBeVisible()
    expect(screen.getByText((_, element) => element?.textContent === '1 değişiklik onayınızı bekliyor. Onaylayana kadar yayımlanmış revizyon değişmez; onayladığınızda tümü tek bir r03 revizyonuna aktarılır.', { selector: 'p' })).toBeVisible()
  })

  it('warns that the delivery actions still use the published revision while a draft is open', async () => {
    stubFetch({
      draft: draftPayload([
        { id: 'edit-1', sequence: 1, path: 'title', previousValue: 'Eski', nextValue: 'Yeni', source: 'USER', prompt: null, chatMessageId: null, revertsEditId: null, revertedByEditId: null, createdAt: '2026-09-11T06:00:00Z' },
      ]),
    })

    renderPage()

    expect(await screen.findByText(/PDF ve e-posta hâlâ yayımlanmış r02/)).toBeVisible()
  })

  it('shows a real error instead of demo content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })))

    render(
      <MemoryRouter initialEntries={['/reports/missing']}>
        <ActiveReportProvider>
          <Routes><Route path="/reports/:id" element={<ReportDetail />} /></Routes>
        </ActiveReportProvider>
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Bülten kaydı bulunamadı')).toBeVisible())
  })

  it('warns at once when the report gained a revision while the draft was open', async () => {
    // Otherwise the draft quietly hides the newer revision and reloading changes
    // nothing, so the reader believes their request never ran.
    stubFetch({ draft: staleDraftPayload() })

    renderPage()

    expect(await screen.findByText(/r03 sürümüne güncellendi/)).toBeVisible()
    expect(screen.getByRole('button', { name: /Taslağı bırak, r03 sürümünü aç/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Onayla ve r03 oluştur/ })).toBeNull()
  })
})
