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
let compiled: TemplateDefinitionV2[] = []
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })

beforeEach(() => {
  saved = []
  compiled = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/v2/templates' && method === 'GET') return json([{ id: 't1', title: 'Standart bülten', description: 'Günlük', sectionCount: 2, isDefault: true, currentVersion: 3, updatedAt: '2026-10-17T10:00:00Z' }])
      if (url === '/api/v2/templates/ai/compile') {
        const d = (JSON.parse(String(init!.body)) as { definition: TemplateDefinitionV2 }).definition
        compiled.push(d)
        return json({ compiled: {}, definition: { ...d, brief: 'Çevrilmiş brief.', sections: d.sections.map((s) => ({ ...s, sectionDescription: `çevrildi: ${s.id}` })) } })
      }
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

const openTemplate = async () => {
  render(<MemoryRouter><TemplatesPage /></MemoryRouter>)
  await userEvent.click(await screen.findByRole('button', { name: 'Standart bülten aç' }))
  await screen.findByRole('group', { name: 'Bileşen seçimi' })
}
const savedDefinition = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
  await waitFor(() => expect(saved).toHaveLength(1))
  return (saved[0] as { definition: TemplateDefinitionV2 }).definition
}

describe('v2 şablon sayfası (§10.1)', () => {
  it('liste Kaynaklar düzeninde: açıklama, bileşen sayısı, varsayılan', async () => {
    render(<MemoryRouter><TemplatesPage /></MemoryRouter>)
    const list = await screen.findByRole('region', { name: 'Rapor şablonları' })
    expect(within(list).getByText('Günlük')).toBeInTheDocument()
    expect(within(list).getByText('2 bileşen')).toBeInTheDocument()
    expect(within(list).getByText('Varsayılan')).toBeInTheDocument()
  })

  it('her bileşen küçük önizleme ve isim düğmesiyle görünür; şablondakiler seçili, sıralama yok', async () => {
    await openTemplate()
    const group = screen.getByRole('group', { name: 'Bileşen seçimi' })
    expect(within(group).getAllByRole('switch')).toHaveLength(3)
    expect(within(group).getByRole('switch', { name: 'Özet' })).toHaveAttribute('aria-checked', 'true')
    expect(within(group).getByRole('switch', { name: 'İstisnalar' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('button', { name: /yukarı/ })).toBeNull()
    expect(screen.queryByText(/Yeni bileşen/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Kaydet' })).toBeDisabled()
  })

  it('isim düğmesiyle bileşen kapatılır/eklenir; tarif yoksa çeviri çağrılmadan kaydedilir', async () => {
    await openTemplate()
    await userEvent.click(screen.getByRole('switch', { name: 'Kaynaklar' }))
    await userEvent.click(screen.getByRole('switch', { name: 'İstisnalar' }))
    const d = await savedDefinition()
    expect(compiled).toHaveLength(0)
    expect(d.sections.find((s) => s.id === 'kaynaklar')!.enabled).toBe(false)
    expect(d.sections.find((s) => s.id === 'istisnalar')).toMatchObject({ componentKey: 'istisnalar', componentVersion: 2, enabled: true, order: 2 })
  })

  it('rapor tarifi kaydederken sistem biçimine çevrilir ve çevrilmiş hali kaydedilir', async () => {
    await openTemplate()
    await userEvent.type(screen.getByLabelText('Rapor tarifi'), 'Otomotiv ithalatçıları için kısa rapor.')
    expect(screen.getByText(/kaydederken yeniden çevrilecek/)).toBeInTheDocument()
    const d = await savedDefinition()
    expect(compiled).toHaveLength(1)
    expect(compiled[0]!.request).toBe('Otomotiv ithalatçıları için kısa rapor.')
    expect(d.brief).toBe('Çevrilmiş brief.')
    expect(d.request).toBe('Otomotiv ithalatçıları için kısa rapor.')
    expect(d.sections.find((s) => s.id === 'ozet')!.sectionDescription).toBe('çevrildi: ozet')
  })
})
