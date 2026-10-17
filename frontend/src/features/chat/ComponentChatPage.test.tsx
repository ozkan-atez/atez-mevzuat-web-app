import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { cleanup, render, screen, waitFor } from '../../test/test-utils'
import { ComponentChatPage } from './ComponentChatPage'

const calls: { url: string; method: string; body?: Record<string, unknown> }[] = []
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
const draft = (name: string) => ({ ok: true, reply: `${name} hazırladım; eylemleri madde madde listeler.`, name, description: 'Yapılacaklar', category: 'NOT_UYARI', definition: { schemaVersion: 1, nodes: [], slots: [], appliesWhen: '', bindings: [], sampleData: { slots: {} } }, rawDefinition: {}, issues: [], previewHtml: '<p>taslak</p>', repairRounds: 0 })

beforeEach(() => {
  calls.length = 0
  let n = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url === '/api/v2/components/ai/draft') return json(draft(n++ === 0 ? 'Eylem kutusu' : 'Eylem kutusu (rozetli)'))
      if (url === '/api/v2/components' && method === 'POST') return json({ id: 'c9', key: 'eylem-kutusu', name: 'Eylem kutusu (rozetli)' }, 201)
      return json({ error: 'NOT_FOUND' }, 404)
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('sohbetten bileşen oluşturma', () => {
  it('istek taslak kartı üretir; takip mesajı son taslağı temel alır; kayıt yalnızca butonla', async () => {
    render(<MemoryRouter><ComponentChatPage /></MemoryRouter>)
    await userEvent.type(screen.getByLabelText('Bileşen isteği'), 'Firmaların yapacaklarını listeleyen kutu{Enter}')
    expect(await screen.findByText(/Eylem kutusu hazırladım/)).toBeInTheDocument()
    expect(screen.getByTitle('Eylem kutusu önizlemesi')).toBeInTheDocument()
    expect(calls.some((c) => c.url === '/api/v2/components' && c.method === 'POST')).toBe(false)

    await userEvent.type(screen.getByLabelText('Bileşen isteği'), 'Başlığa rozet ekle{Enter}')
    expect(await screen.findByText(/rozetli\) hazırladım/)).toBeInTheDocument()
    const second = calls.filter((c) => c.url === '/api/v2/components/ai/draft')[1]!.body!
    expect(second.base).toMatchObject({ name: 'Eylem kutusu' })
    expect(second.conversation).toHaveLength(2)

    const buttons = screen.getAllByRole('button', { name: 'Havuza ekle ve aktifleştir' })
    await userEvent.click(buttons.at(-1)!)
    await waitFor(() => expect(calls).toContainEqual(expect.objectContaining({ url: '/api/v2/components', method: 'POST', body: expect.objectContaining({ name: 'Eylem kutusu (rozetli)', origin: 'AI', activate: true }) })))
    expect(await screen.findByText(/havuza eklendi ve aktifleştirildi/)).toBeInTheDocument()
  })
})
