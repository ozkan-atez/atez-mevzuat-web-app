import { cleanup, render, screen, waitFor } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourcesPage } from './CatalogPages'
import { MemoryRouter } from 'react-router-dom'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('Persistent workspace catalog', () => {
  it('reads actual sources and persists a new source through the API', async () => {
    const writes: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'POST') { writes.push(JSON.parse(String(options.body))); return new Response(JSON.stringify({ id: 'new-source' }), { status: 201 }) }
      if(String(_url).includes('managed-sources'))return new Response(JSON.stringify({sources:[]}))
      if(String(_url).includes('documents?'))return new Response(JSON.stringify({documents:[]}))
      return new Response(JSON.stringify({ sources: [{ id: 'rg', key: 'resmi-gazete', name: 'Resmî Gazete', baseUrl: 'https://www.resmigazete.gov.tr', authorityType: 'OFFICIAL', isActive: true, scanSupported: true, lastScanned: null }] }))
    }))
    render(<MemoryRouter><SourcesPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Resmî Gazete' })).toBeVisible()
    expect(screen.queryByRole('button',{name:'Kaynağı tara'})).not.toBeInTheDocument()
    expect(screen.getAllByRole('button',{name:'Test et'})).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: /Kaynak ekle/ }))
    await userEvent.type(screen.getByLabelText('Kaynak adı'), 'Ticaret Bakanlığı')
    await userEvent.type(screen.getByLabelText('Kaynak bağlantısı'), 'https://ticaret.gov.tr')
    await userEvent.click(screen.getByRole('button', { name: 'Bağlantıyı kur' }))
    await waitFor(() => expect(writes).toEqual([expect.objectContaining({ name: 'Ticaret Bakanlığı', url: 'https://ticaret.gov.tr' })]))
  })
})
