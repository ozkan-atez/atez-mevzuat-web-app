import { cleanup, fireEvent, render, screen, waitFor } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourcesPage, TemplatesPage } from './CatalogPages'
import { MemoryRouter } from 'react-router-dom'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('Persistent workspace catalog', () => {
  it('reads actual sources and persists a new source through the API', async () => {
    const writes: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'POST') { writes.push(JSON.parse(String(options.body))); return new Response(JSON.stringify({ id: 'new-source' }), { status: 201 }) }
      return new Response(JSON.stringify({ sources: [{ id: 'rg', key: 'resmi-gazete', name: 'Resmî Gazete', baseUrl: 'https://www.resmigazete.gov.tr', authorityType: 'OFFICIAL', isActive: true, scanSupported: true, lastScanned: null }] }))
    }))
    render(<MemoryRouter><SourcesPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Resmî Gazete' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: /Kaynak sitesi ekle/ }))
    await userEvent.type(screen.getByLabelText('Kaynak adı'), 'Ticaret Bakanlığı')
    await userEvent.type(screen.getByLabelText('Kısa kod'), 'ticaret-bakanligi')
    await userEvent.type(screen.getByLabelText('Kaynak bağlantısı'), 'https://ticaret.gov.tr')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(writes).toEqual([expect.objectContaining({ name: 'Ticaret Bakanlığı', key: 'ticaret-bakanligi', baseUrl: 'https://ticaret.gov.tr', authorityType: 'REFERENCE' })]))
  })

  it('waits for the catalog before opening a new template with default sections', async () => {
    let resolve!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve=done })))
    render(<MemoryRouter><TemplatesPage /></MemoryRouter>)
    const create=screen.getByRole('button',{name:/Şablon oluştur/})
    expect(create).toBeDisabled()
    resolve(new Response(JSON.stringify({templates:[],components:[{id:'summary',heading:'Özet',html:'<section><h2>Özet</h2><p>Metin</p></section>',enabled:true}],defaultSections:[{id:'summary',heading:'Özet',html:'<section><h2>Özet</h2><p>Metin</p></section>',enabled:true}],defaultHtml:'<header>ATEZ</header>{{sections}}'})))
    await waitFor(()=>expect(create).toBeEnabled())
    await userEvent.click(create)
    const frame=screen.getByTitle('Görsel şablon düzenleyici')
    expect(frame.getAttribute('srcdoc')).toContain('data-vte-section="summary"')
    expect(frame.getAttribute('srcdoc')).toContain('<header>ATEZ</header>')
  })

  it('persists content edits while keeping template headings and layout fixed', async () => {
    const writes: Record<string, unknown>[] = []
    const template = { id: 'template-1', name: 'ATEZ günlük', description: 'Günlük rapor', html: '<main>{{sections}}</main>', isActive: true, sections: [{ id: 'summary', heading: 'Özet', html: '<section><h2>{{heading}}</h2><p data-template-content="summary">İlk metin</p></section>', enabled: true }] }
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'PATCH') { writes.push(JSON.parse(String(options.body))); return new Response(JSON.stringify(template)) }
      return new Response(JSON.stringify({ templates: [template], components: template.sections, defaultHtml: template.html }))
    }))
    render(<MemoryRouter><TemplatesPage /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: /Şablonu düzenle/ }))
    const frame = screen.getByTitle('Görsel şablon düzenleyici') as HTMLIFrameElement
    const doc = frame.contentDocument!
    doc.open(); doc.write(frame.getAttribute('srcdoc')!); doc.close(); fireEvent.load(frame)
    expect(doc.querySelector('[data-vte-heading]')).toBeNull()
    const content = doc.querySelector<HTMLElement>('[data-template-content]')!
    content.textContent = 'Düzeltilmiş metin'; fireEvent.focusOut(content)
    await userEvent.click(screen.getByRole('button', { name: 'Şablonu kaydet' }))
    await waitFor(() => expect(writes[0]).toMatchObject({ html: '<main>{{sections}}</main>', sections: [{ id: 'summary', heading: 'Özet', html: expect.stringContaining('Düzeltilmiş metin') }] }))
  })
})
