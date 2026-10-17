import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { cleanup, render, screen, waitFor, within } from '../../test/test-utils'
import { ComponentPoolPage } from './ComponentPoolPage'

const comps = [
  { id: 'c1', key: 'ozet', name: 'Özet', description: 'Giriş', category: 'OZET', origin: 'BUILTIN', status: 'ACTIVE', currentVersion: 1, usage: 2, definition: { appliesWhen: '', bindings: [], slots: [] } },
  { id: 'c2', key: 'gecici', name: 'Geçici kart', description: 'Deneme', category: 'NOT_UYARI', origin: 'USER', status: 'INACTIVE', currentVersion: 1, usage: 0, definition: { appliesWhen: '', bindings: [], slots: [] } },
]
const calls: { url: string; method: string; body?: unknown }[] = []
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
beforeEach(() => {
  calls.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (/\/preview/.test(url)) return json({ html: '<p>önizleme</p>' })
      if (url.startsWith('/api/v2/components?')) return json(comps)
      if (url === '/api/v2/components/c2' && method === 'PATCH') return json({ ok: true })
      if (url === '/api/v2/components/ai/draft')
        return json({ ok: true, name: 'Eylem kutusu', description: 'Yapılacaklar', category: 'NOT_UYARI', definition: { schemaVersion: 1, nodes: [], slots: [], appliesWhen: '', bindings: ['analysis.summary'], sampleData: { slots: {} } }, rawDefinition: {}, issues: [], previewHtml: '<p>taslak</p>', repairRounds: 0 })
      if (url === '/api/v2/components' && method === 'POST') return json({ ...comps[0], id: 'c9', name: 'Eylem kutusu' }, 201)
      return json({ error: 'NOT_FOUND' }, 404)
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('bileşen havuzu (§10.1)', () => {
  it('canlı önizlemeli kartları ve durum etiketlerini gösterir; pasif bileşeni aktifleştirir', async () => {
    render(<MemoryRouter><ComponentPoolPage /></MemoryRouter>)
    expect(await screen.findByText('Geçici kart')).toBeVisible()
    await waitFor(() => expect(screen.getAllByTitle(/önizlemesi/).length).toBe(2))
    expect(screen.getByText('2 şablon sürümünde')).toBeVisible()
    await userEvent.click(screen.getByRole('switch', { name: 'Geçici kart aktif' }))
    await waitFor(() => expect(calls).toContainEqual({ url: '/api/v2/components/c2', method: 'PATCH', body: { status: 'ACTIVE' } }))
  })

  it('AI paneli taslak üretir, önizler ve kullanıcı onayıyla kaydeder', async () => {
    render(<MemoryRouter initialEntries={['/templates/components?ai=1']}><ComponentPoolPage /></MemoryRouter>)
    const drawer = await screen.findByRole('dialog')
    await userEvent.type(within(drawer).getByLabelText('Bileşen isteği'), 'Yapılacaklar kutusu')
    await userEvent.click(within(drawer).getByRole('button', { name: /Oluştur/ }))
    expect(await within(drawer).findByTitle('Taslak önizlemesi')).toBeInTheDocument()
    expect(calls.some((c) => c.url === '/api/v2/components' && c.method === 'POST')).toBe(false) // otomatik kayıt yok
    await userEvent.click(within(drawer).getByRole('button', { name: /Kaydet ve aktifleştir/ }))
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ url: '/api/v2/components', method: 'POST', body: expect.objectContaining({ name: 'Eylem kutusu', origin: 'AI', activate: true }) })))
  })
})
