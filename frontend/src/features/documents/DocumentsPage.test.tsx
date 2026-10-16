import { ConfigProvider } from 'antd'
import { cleanup, render, screen, waitFor } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentsPage } from './DocumentsPage'
import { DocumentPicker } from './DocumentPicker'
import { streamChatMessage } from '../chat/api'
const doc = { id: 'doc1', title: 'Yüklenen mevzuat', origin: 'UPLOAD', publishedOn: null, latestVersion: { id: 'immutable-v1', mimeType: 'text/plain', extractionStatus: 'EXTRACTED', originalFilename: 'mevzuat.txt', createdAt: '' }, versions: [] }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('document flows', () => {
  it('shows metadata and safe source links without extraction or selection controls', async () => {
    const fetcher = vi.fn(async (_url:string) => new Response(JSON.stringify({documents:[{...doc,canonicalUrl:'https://www.resmigazete.gov.tr/example',latestVersion:{...doc.latestVersion,hasOriginal:true}}],total:1})))
    vi.stubGlobal('fetch',fetcher)
    render(<ConfigProvider theme={{token:{motion:false}}}><MemoryRouter><DocumentsPage /></MemoryRouter></ConfigProvider>)
    const directSource = await screen.findByRole('link',{name:'Yüklenen mevzuat kaynağını aç'})
    expect(directSource).toHaveAttribute('href','https://www.resmigazete.gov.tr/example')
    expect(directSource).toHaveAttribute('target','_blank')
    expect(directSource).toHaveAttribute('rel','noopener noreferrer')
    await userEvent.click(await screen.findByRole('button',{name:'İncele'}))
    expect(screen.getByRole('link',{name:'Kaynağı aç'})).toHaveAttribute('rel','noopener noreferrer')
    expect(screen.getByRole('link',{name:'Özgün dosyayı indir'})).toHaveAttribute('href','/api/v1/document-versions/immutable-v1/original')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('classification=IN')
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('sort=OLDEST')
    expect(screen.queryByText('Metni incele')).not.toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('collapses filters and sends publication dates to the archive',async()=>{
    const fetcher=vi.fn(async(_url:string)=>new Response(JSON.stringify({documents:[doc],total:1})))
    vi.stubGlobal('fetch',fetcher);render(<DocumentsPage />)
    expect(screen.queryByLabelText('Yayın başlangıcı')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button',{name:'Filtreler'}))
    await userEvent.type(screen.getByLabelText('Yayın başlangıcı'),'2026-10-01')
    await waitFor(()=>expect(fetcher.mock.calls.some(call=>String(call[0]).includes('from=2026-10-01'))).toBe(true))
    await userEvent.click(screen.getByRole('button',{name:/Filtreler/}))
    expect(screen.queryByLabelText('Yayın başlangıcı')).not.toBeInTheDocument()
  })
  it('archives uploads in original-only mode',async()=>{
    const fetcher=vi.fn(async(_url:string,init?:RequestInit)=>new Response(JSON.stringify(init?.method==='POST'?{document:doc,version:doc.latestVersion}:{documents:[],total:0})))
    vi.stubGlobal('fetch',fetcher);render(<DocumentsPage />)
    await userEvent.click(screen.getByRole('button',{name:'Belge ekle'}))
    await userEvent.upload(screen.getByLabelText('Arşive belge yükle'),new File(['hello'],'test.txt',{type:'text/plain'}))
    await userEvent.click(screen.getByRole('button',{name:'Arşive ekle'}))
    await waitFor(()=>expect(fetcher.mock.calls.some(call=>call[1]?.method==='POST')).toBe(true))
    const body=fetcher.mock.calls.find(call=>call[1]?.method==='POST')![1]!.body as FormData
    expect(body.get('originalOnly')).toBe('true')
  })
  it('only uploads a file and does not start analysis', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST' ? { document: doc, version: doc.latestVersion } : { documents: [], total: 0 }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const onSelect = vi.fn()
    render(<DocumentPicker open selected={[]} onClose={() => {}} onSelect={onSelect} />)
    await userEvent.upload(screen.getByLabelText('Yüklenecek belge'), new File(['mevzuat metni'], 'mevzuat.txt', { type: 'text/plain' }))
    await screen.findByText('Yüklenen mevzuat')
    await userEvent.click(screen.getByText('Seçilenleri ekle'))
    expect(onSelect).toHaveBeenCalledWith([{ id: 'immutable-v1', title: 'Yüklenen mevzuat' }])
    const posts = fetcher.mock.calls.filter(call => call[1]?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0]![0]).toBe('/api/v1/documents/uploads')
    expect(posts[0]![1]!.body).toBeInstanceOf(FormData)
  })
  it('paginates the archive',async()=>{
    const fetcher=vi.fn(async(url:string)=>new Response(JSON.stringify({documents:new URL(url,'http://localhost').searchParams.get('page')==='2'?[{...doc,id:'doc2',title:'İkinci sayfa belgesi'}]:[doc],total:61})))
    vi.stubGlobal('fetch',fetcher);render(<DocumentsPage />)
    await screen.findByText('Yüklenen mevzuat')
    await userEvent.click(screen.getByTitle('2'))
    expect(await screen.findByText('İkinci sayfa belgesi')).toBeInTheDocument()
  })
  it('adds documentVersionIds to chat without sending document bytes', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(''))
    vi.stubGlobal('fetch', fetcher)
    await streamChatMessage('chat1', 'Belgeyi analiz et', new AbortController().signal, ['immutable-v1'])
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({ content: 'Belgeyi analiz et', documentVersionIds: ['immutable-v1'] })
  })
})
