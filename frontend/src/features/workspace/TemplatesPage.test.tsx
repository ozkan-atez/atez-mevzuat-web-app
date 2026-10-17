import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { cleanup, render, screen, waitFor, within } from '../../test/test-utils'
import { TemplatesPage } from './TemplatesPage'
import type { TemplateDefinitionV2 } from './studio-types'

const definition: TemplateDefinitionV2 = {
  schemaVersion: 1,
  title: 'Standart bülten',
  description: '',
  brief: 'Müşavirler için kısa bülten.',
  theme: { tokens: {} },
  shell: { heading: 'ATEZ', showFooter: true },
  sections: [
    { id: 'ozet', componentKey: 'ozet', componentVersion: 1, enabled: true, order: 0, heading: 'Özet', sectionDescription: '', required: true, missingDataRule: 'NOTE' },
    { id: 'kaynaklar', componentKey: 'kaynaklar', componentVersion: 1, enabled: true, order: 1, heading: 'Kaynaklar', sectionDescription: '', required: false, missingDataRule: 'OMIT' },
  ],
}
const comps = [
  { id: 'c1', key: 'ozet', name: 'Özet', description: 'Giriş', category: 'OZET', origin: 'BUILTIN', status: 'ACTIVE', currentVersion: 1, definition: {} },
  { id: 'c2', key: 'kaynaklar', name: 'Kaynaklar', description: 'Belgeler', category: 'KAYNAKLAR', origin: 'BUILTIN', status: 'ACTIVE', currentVersion: 1, definition: {} },
  { id: 'c3', key: 'istisnalar', name: 'İstisnalar', description: 'Geçiş hükümleri', category: 'NOT_UYARI', origin: 'AI', status: 'ACTIVE', currentVersion: 2, definition: {} },
]
let saved: unknown[] = []
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })

beforeEach(() => {
  saved = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/v2/templates' && method === 'GET') return json([{ id: 't1', title: 'Standart bülten', isDefault: true, currentVersion: 3, updatedAt: '2026-10-17T10:00:00Z' }])
      if (url === '/api/v2/templates/t1' && method === 'GET') return json({ id: 't1', isDefault: true, version: 3, versionId: 'v3', definition, versions: [] })
      if (url === '/api/v2/templates/t1' && method === 'PUT') {
        saved.push(JSON.parse(String(init!.body)))
        return json({ version: 4 })
      }
      if (url.startsWith('/api/v2/components')) return json(comps)
      if (url === '/api/v2/templates/preview') return json({ html: '<p>önizleme</p>', sections: [{ id: 'ozet', state: 'RENDERED' }, { id: 'kaynaklar', state: 'OMITTED' }] })
      return json({ error: 'NOT_FOUND' }, 404)
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('v2 şablon editörü (§10.1)', () => {
  it('bölümleri yapılandırılmış liste olarak gösterir; açıklama, kural ve sıra değişikliği yeni sürüm olarak kaydedilir', async () => {
    render(<MemoryRouter><TemplatesPage /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: 'Şablonu düzenle' }))
    const list = await screen.findByRole('list', { name: 'Rapor bölümleri' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByLabelText('Şablon açıklaması')).toBeNull() // eski tek metin kutusu yok
    await userEvent.type(screen.getByLabelText('Bölüm açıklaması'), 'Gözetim belgesini öne çıkar.')
    await userEvent.click(within(list).getByText('Kaynaklar'))
    await userEvent.click(screen.getByRole('radio', { name: '“Kaynakta yok” notu' }).closest('label')!)
    await userEvent.click(screen.getByRole('button', { name: 'Kaynaklar yukarı' }))
    await userEvent.click(screen.getByRole('button', { name: 'Şablonu kaydet' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    const d = (saved[0] as { definition: TemplateDefinitionV2 }).definition
    const byId = Object.fromEntries(d.sections.map((s) => [s.id, s]))
    expect(byId.ozet!.sectionDescription).toBe('Gözetim belgesini öne çıkar.')
    expect(byId.kaynaklar!.missingDataRule).toBe('NOTE')
    expect(byId.kaynaklar!.order).toBe(0)
    expect(byId.ozet!.order).toBe(1)
  })

  it('havuzdan aktif bileşen ekler ve bölümü kapatır', async () => {
    render(<MemoryRouter><TemplatesPage /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: 'Şablonu düzenle' }))
    await userEvent.click(await screen.findByRole('switch', { name: 'Kaynaklar açık' }))
    await userEvent.click(screen.getByRole('button', { name: /Havuzdan ekle/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Havuzdan ekle' })
    const row = within(dialog).getByText('İstisnalar').closest('li')!
    await userEvent.click(within(row).getByRole('button', { name: 'Ekle' }))
    await userEvent.click(screen.getByRole('button', { name: 'Şablonu kaydet' }))
    await waitFor(() => expect(saved).toHaveLength(1))
    const d = (saved[0] as { definition: TemplateDefinitionV2 }).definition
    expect(d.sections.find((s) => s.id === 'kaynaklar')!.enabled).toBe(false)
    expect(d.sections.find((s) => s.id === 'istisnalar')).toMatchObject({ componentKey: 'istisnalar', componentVersion: 2, enabled: true, order: 2 })
  })

  it('zorunlu bölümde "gizle" kuralı seçilemez', async () => {
    render(<MemoryRouter><TemplatesPage /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: 'Şablonu düzenle' }))
    await screen.findByRole('list', { name: 'Rapor bölümleri' })
    expect(screen.getByRole('radio', { name: 'Bölümü gizle' })).toBeDisabled()
  })
})
