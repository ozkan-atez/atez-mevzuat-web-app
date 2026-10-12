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
  it('opens the original source directly and keeps text previews for documents without a web source', async () => {
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/content') ? {text:'Yüklenen belge içeriği'} : {documents:[{...doc,id:'source',title:'Resmî kaynak',origin:'SOURCE',canonicalUrl:'https://www.resmigazete.gov.tr/eskiler/2026/10/20261012-1.htm'},doc,{...doc,id:'invalid',title:'Geçersiz bağlantı',canonicalUrl:'javascript:alert(1)'}],total:3})))
    vi.stubGlobal('fetch',fetcher)
    render(<ConfigProvider theme={{token:{motion:false}}}><MemoryRouter><DocumentsPage /></MemoryRouter></ConfigProvider>)
    const source = await screen.findByRole('link',{name:'Kaynağı aç'})
    expect(source).toHaveAttribute('href','https://www.resmigazete.gov.tr/eskiler/2026/10/20261012-1.htm')
    expect(source).toHaveAttribute('target','_blank')
    expect(source).toHaveAttribute('rel','noopener noreferrer')
    expect(screen.getAllByRole('button',{name:'Metni incele'})).toHaveLength(2)
    expect(fetcher.mock.calls.some(([url])=>url.includes('/content'))).toBe(false)
    await userEvent.click(screen.getAllByRole('button',{name:'Metni incele'})[0]!)
    await waitFor(() => expect(screen.getByText('Yüklenen belge içeriği')).toBeVisible())
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
  it('sends selected immutable versions and explicit mode for analysis', async () => {
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => new Response(JSON.stringify(url.includes('/operations') ? { id: 'op1', status: 'SUCCEEDED', operation: 'ANALYZE', mode: 'FILL_MISSING', tasks: [] } : { documents: [doc], total: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    render(<MemoryRouter><DocumentsPage /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Yüklenen mevzuat' }))
    await userEvent.click(screen.getByLabelText('İşlem adımı'))
    await userEvent.click(await screen.findByText('Belgeleri analiz et'))
    await userEvent.click(screen.getByLabelText('Çalıştırma biçimi'))
    await userEvent.click(await screen.findByText('Eksik adımları tamamla'))
    await userEvent.click(screen.getByRole('button', { name: /İşlemi başlat/ }))
    await waitFor(() => expect(fetcher.mock.calls.some(call => call[0] === '/api/v1/operations' && call[1]?.method === 'POST')).toBe(true))
    const post = fetcher.mock.calls.find(call => call[0] === '/api/v1/operations' && call[1]?.method === 'POST')!
    expect(JSON.parse(String(post[1]!.body))).toEqual({ operation: 'ANALYZE', mode: 'FILL_MISSING', documentVersionIds: ['immutable-v1'], documentRoles: { 'immutable-v1':'PRIMARY' } })
  })
  it('paginates all documents while preserving selected titles from earlier pages',async()=>{
    const fetcher=vi.fn(async(url:string,_init?:RequestInit)=>new Response(JSON.stringify({documents:new URL(url,'http://localhost').searchParams.get('page')==='2'?[{...doc,id:'doc2',title:'İkinci sayfa belgesi',latestVersion:{...doc.latestVersion,id:'immutable-v2'}}]:[doc],total:61})))
    vi.stubGlobal('fetch',fetcher)
    render(<MemoryRouter><DocumentsPage /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('checkbox',{name:'Yüklenen mevzuat'}))
    await userEvent.click(screen.getByTitle('2'))
    expect(await screen.findByRole('checkbox',{name:'İkinci sayfa belgesi'})).toBeInTheDocument()
    expect(screen.getByLabelText('Yüklenen mevzuat belgesini kaldır')).toBeVisible()
    expect(fetcher.mock.calls.some(call=>new URL(call[0],'http://localhost').searchParams.get('page')==='2')).toBe(true)
  })
  it('adds documentVersionIds to chat without sending document bytes', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(''))
    vi.stubGlobal('fetch', fetcher)
    await streamChatMessage('chat1', 'Belgeyi analiz et', new AbortController().signal, ['immutable-v1'])
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({ content: 'Belgeyi analiz et', documentVersionIds: ['immutable-v1'] })
  })
})
