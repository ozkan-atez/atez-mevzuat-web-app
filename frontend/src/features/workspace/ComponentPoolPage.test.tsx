import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { cleanup, render, screen, waitFor } from '../../test/test-utils'
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

  it('"Bileşen oluştur" sohbete yönlendirir; üst kısım şablonlarla aynı', async () => {
    render(
      <MemoryRouter initialEntries={['/templates/components']}>
        <Routes>
          <Route path="/templates/components" element={<ComponentPoolPage />} />
          <Route path="/chat" element={<p>sohbet ekranı</p>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('radio', { name: /Şablonlar/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Bileşen oluştur/ }))
    expect(await screen.findByText('sohbet ekranı')).toBeInTheDocument()
  })
})
