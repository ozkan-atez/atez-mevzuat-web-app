import { cleanup, render, screen, waitFor } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceCustomization } from './WorkspaceCustomization'
const view = { draft: null, baseVersion: 1, publishedVersion: 1, isStale: false, spec: {}, html: '' }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('WorkspaceCustomization', () => {
  it('opens the rendered page editor without exposing HTML fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ templates: [], components: [], sources: [] })))))
    const save = vi.fn().mockResolvedValue(undefined)
    render(<WorkspaceCustomization view={{ ...view, html: '<html><body><article class="card"><section><h2>Özet</h2><p>Gerçek rapor</p></section></article></body></html>' }} isBusy={false} onSave={save} onAddSource={vi.fn()} />)
    await userEvent.click(screen.getByText('Başlıklar, düzen ve bileşenler'))
    await userEvent.click(screen.getByRole('button', { name: 'Sayfayı görsel olarak düzenle' }))
    expect(await screen.findByTitle('Görsel şablon düzenleyici')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Özel rapor HTML gövdesi' })).not.toBeInTheDocument()
    const heading = screen.getByRole('textbox', { name: 'Bölüm 1 başlığını düzenle' })
    await userEvent.clear(heading); await userEvent.type(heading, 'Yönetici özeti')
    await userEvent.click(screen.getByRole('button', { name: 'Düzeni taslağa uygula' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ customHtml: '<section><h2>Yönetici özeti</h2><p>Gerçek rapor</p></section>' })))
  })
  it('adds a named source through the report draft API callback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ templates: [], components: [], sources: [] })))))
    const add = vi.fn().mockResolvedValue(undefined)
    render(<WorkspaceCustomization view={view} isBusy={false} onSave={vi.fn()} onAddSource={add} />)
    await userEvent.click(screen.getByText('Rapora yeni kaynak ekle'))
    await userEvent.type(screen.getByLabelText('Kaynak adı'), 'Ticaret Bakanlığı')
    await userEvent.type(screen.getByLabelText('Bağlantı'), 'https://ticaret.gov.tr')
    await userEvent.type(screen.getByLabelText('Kaynak içeriği / alıntı'), 'Mevzuat kaynak açıklaması')
    await userEvent.click(screen.getByRole('button', { name: 'Kaynağı taslağa ekle' }))
    await waitFor(() => expect(add).toHaveBeenCalledWith({ label: 'Ticaret Bakanlığı', url: 'https://ticaret.gov.tr', content: 'Mevzuat kaynak açıklaması', kind: 'URL' }))
  })
  it('applies a saved template through the existing server callback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(new Response(JSON.stringify(url.endsWith('/templates') ? { templates: [{ id: 'template-1', name: 'Günlük bülten', html: '<h1>{{title}}</h1>', sections: [] }], components: [] } : { sources: [] })))))
    const apply = vi.fn().mockResolvedValue(undefined)
    render(<WorkspaceCustomization view={view} isBusy={false} onApplyTemplate={apply} onSave={vi.fn()} onAddSource={vi.fn()} />)
    await userEvent.click(screen.getByText('Başlıklar, düzen ve bileşenler'))
    await userEvent.click(screen.getByRole('combobox', { name: 'Rapor şablonu' }))
    await userEvent.click(await screen.findByText('Günlük bülten'))
    await waitFor(() => expect(apply).toHaveBeenCalledWith('template-1'))
  })
  it('requires evidence text before a new source can be submitted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ templates: [], components: [], sources: [] }))))
    const add = vi.fn()
    render(<WorkspaceCustomization view={view} isBusy={false} onSave={vi.fn()} onAddSource={add} />)
    await userEvent.click(screen.getByText('Rapora yeni kaynak ekle'))
    await userEvent.type(screen.getByLabelText('Kaynak adı'), 'Ticaret Bakanlığı')
    await userEvent.type(screen.getByLabelText('Bağlantı'), 'https://ticaret.gov.tr')
    await userEvent.click(screen.getByRole('button', { name: 'Kaynağı taslağa ekle' }))
    await waitFor(() => expect(screen.getByText('Kaynağın rapora esas olacak içeriğini girin.')).toBeVisible())
    expect(add).not.toHaveBeenCalled()
  })

})
