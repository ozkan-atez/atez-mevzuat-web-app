import { cleanup, render, screen, waitFor, within } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceRunDetail } from './SourceRunDetail'
import { SourceRunsPanel } from './SourceRunsPanel'
import type { SourceRunDocument } from './sourceRunsApi'
const document = (patch: Partial<SourceRunDocument>): SourceRunDocument => ({ id: 'doc-1', title: 'İthalat değişikliği', url: 'https://ticaret.gov.tr/current', publishedOn: '2026-10-08', feedUrl: null, contentText: 'Resmî içerik', filterDecision: 'IN', filterReason: 'İthalat düzenlemesi', processingStatus: 'COMPLETED', processingError: null, topicId: 'actual-topic-1', reportVersion: 2, ...patch })
const run = (documents: SourceRunDocument[]) => ({ id: 'source-run-1', targetDate: '2026-10-08', status: 'COMPLETED', errorSummary: null, hasReport: true, scanRunId: null, source: { name: 'Ticaret Bakanlığı', key: 'ticaret' }, _count: { documents: documents.length }, documents })
function renderDetail() { render(<MemoryRouter initialEntries={['/source-runs/source-run-1']}><Routes><Route path="/source-runs/:id" element={<SourceRunDetail />} /></Routes></MemoryRouter>) }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('AI processed external source runs', () => {
  it('opens only actual published topic reports and explains excluded, failed and pending documents', async () => {
    const records = [document({}), document({ id: 'out', title: 'Spor haberi', filterDecision: 'OUT', filterReason: 'Dış ticaret kapsamında değil', processingStatus: 'EXCLUDED', topicId: null, reportVersion: null }), document({ id: 'failed', title: 'İşlenemeyen belge', processingStatus: 'FAILED', processingError: 'AI sağlayıcısı yanıt vermedi', topicId: null, reportVersion: null }), document({ id: 'pending', title: 'Bekleyen belge', filterDecision: null, processingStatus: 'PENDING', filterReason: null, topicId: null, reportVersion: null })]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(run(records)))))
    renderDetail()
    const link = (await screen.findByText('Raporu aç · r02')).closest('a')!
    expect(link).toHaveAttribute('href', '/chat?topic=actual-topic-1')
    expect(screen.getAllByText(/Raporu aç · r/)).toHaveLength(1)
    expect(screen.getByText('Dış ticaret kapsamında değil')).toBeVisible()
    expect(screen.getByText('AI sağlayıcısı yanıt vermedi')).toBeVisible()
    expect(screen.getByText('AI değerlendirmesi bekliyor')).toBeVisible()
    expect(screen.queryByTitle('Kaynak raporu önizleme')).not.toBeInTheDocument()
    expect(screen.queryByText('HTML indir')).not.toBeInTheDocument()
  })
  it('does not turn an entirely excluded day into a generated report', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(run([document({ filterDecision: 'OUT', processingStatus: 'EXCLUDED', topicId: null, reportVersion: null })])))))
    renderDetail()
    expect(await screen.findByText('Bulunan belgeler gümrük ve dış ticaret kapsamı dışında. Bu tarama için rapor üretilmedi.')).toBeVisible()
    expect(screen.queryByText(/Raporu aç · r/)).not.toBeInTheDocument()
  })
  it('retries a partially failed run through the persistent source-run endpoint', async () => {
    const response = { ...run([document({ processingStatus: 'FAILED', processingError: 'İçerik okunamadı', topicId: null, reportVersion: null })]), status: 'PARTIAL', errorSummary: 'Bir belge işlenemedi' }
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => Promise.resolve(new Response(JSON.stringify(init?.method === 'POST' ? { status: 'QUEUED' } : response))))
    vi.stubGlobal('fetch', fetchMock)
    renderDetail()
    await userEvent.click(await screen.findByRole('button', { name: 'Başarısız işlemleri yeniden dene' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/source-scan-runs/source-run-1/retry', expect.objectContaining({ method: 'POST' })))
  })
  it('lists found and excluded counts separately from ready reports', async () => {
    const summary = { ...run([]), documents: undefined, counters: { found: 6, relevant: 2, excluded: 3, failed: 1, readyReports: 1 } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ runs: [summary] }))))
    render(<MemoryRouter><SourceRunsPanel /></MemoryRouter>)
    const row = (await screen.findByText('Ticaret Bakanlığı')).closest('tr')!
    expect(within(row).getByText('6 belge bulundu')).toBeVisible()
    expect(within(row).getByText('2 ilgili · 3 kapsam dışı · 1 başarısız')).toBeVisible()
    expect(within(row).getByRole('link', { name: 'Belgeleri ve raporları aç' })).toHaveAttribute('href', '/source-runs/source-run-1')
  })
  it('starts AI evaluation for a previously collected day without exposing its old excerpt as a report', async () => {
    const legacy = { ...run([document({ filterDecision: null, processingStatus: 'PENDING', topicId: null, reportVersion: null })]), canAnalyze: true }
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => Promise.resolve(new Response(JSON.stringify(init?.method === 'POST' ? { status: 'QUEUED' } : legacy))))
    vi.stubGlobal('fetch', fetchMock)
    renderDetail()
    await userEvent.click(await screen.findByRole('button', { name: 'AI değerlendirmesini başlat' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/source-scan-runs/source-run-1/analyze', expect.objectContaining({ method: 'POST' })))
    expect(screen.queryByText(/Raporu aç · r/)).not.toBeInTheDocument()
    expect(screen.queryByTitle('Kaynak raporu önizleme')).not.toBeInTheDocument()
  })

  it('tracks independent analysis jobs without changing the archived run status', async () => {
    const archived = { ...run([document({ filterDecision: null, processingStatus: 'PENDING', topicId: null, reportVersion: null })]), canAnalyze: true }
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => new Response(JSON.stringify(url.includes('/operations/') ? { id: 'analysis-op', operation: 'ANALYZE', mode: 'FILL_MISSING', status: 'SUCCEEDED', tasks: [] } : init?.method === 'POST' ? { runId: 'source-run-1', status: 'QUEUED', operationRequestIds: ['analysis-op'], missing: [{ documentId: 'missing-doc' }] } : archived)))
    vi.stubGlobal('fetch', fetcher)
    renderDetail()
    await userEvent.click(await screen.findByRole('button', { name: 'AI değerlendirmesini başlat' }))
    expect(await screen.findByRole('link', { name: 'İşlemi incele' })).toHaveAttribute('href', '/operations/analysis-op')
    expect(screen.getAllByText('Tamamlandı').length).toBeGreaterThan(0)
    expect(screen.getByText('1 belgenin arşiv içeriği eksik. Hazır belgeler için bağımsız değerlendirme başlatıldı.')).toBeVisible()
    const post = fetcher.mock.calls.find(call => call[1]?.method === 'POST')!
    expect(post[1]?.headers).toEqual({ 'Idempotency-Key': expect.any(String), 'X-CSRF-Token': 'test-csrf' })
  })

  it('shows archived original/PDF/image download links separately from missing annex errors',async()=>{
    const record=document({capturedFiles:[{url:'https://ticaret.gov.tr/main.htm',title:'Özgün belge',role:'DOCUMENT',status:'STORED',mediaType:'text/html',byteSize:3000},{url:'https://ticaret.gov.tr/annex.pdf',title:'PDF eki',role:'ATTACHMENT',status:'STORED',mediaType:'application/pdf',byteSize:2048},{url:'https://ticaret.gov.tr/image.png',title:'Cetvel',role:'IMAGE',status:'STORED',mediaType:'image/png',byteSize:1024},{url:'https://ticaret.gov.tr/missing.pdf',title:'Eksik ek',role:'ATTACHMENT',status:'FAILED',error:'HTTP 404'}]})
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(run([record])))))
    renderDetail()
    expect(await screen.findByRole('link',{name:/PDF eki · pdf/})).toHaveAttribute('href','/api/v1/source-scan-runs/source-run-1/documents/doc-1/files/1')
    expect(screen.getByRole('link',{name:/Cetvel · png/})).toHaveAttribute('href','/api/v1/source-scan-runs/source-run-1/documents/doc-1/files/2')
    expect(screen.getByText('Eksik ek: HTTP 404')).toBeVisible()
  })

})
