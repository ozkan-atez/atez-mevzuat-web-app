import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { cleanup, render, screen, waitFor } from '../../test/test-utils'
import { ConversationMessages } from './ConversationMessages'
import type { ChatMessage, ComponentDraftCard } from './types'

const calls: { url: string; method: string; body?: Record<string, unknown> }[] = []
let duplicate = false
beforeEach(() => {
  calls.length = 0
  duplicate = false
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? 'GET'
    calls.push({ url, method, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) })
    if (url === '/api/v2/components' && method === 'POST')
      return duplicate ? new Response(JSON.stringify({ error: 'ALREADY_EXISTS', message: 'Bu taslak zaten havuza kaydedildi.' }), { status: 409 }) : new Response(JSON.stringify({ id: 'c9', name: 'Eylem kutusu', currentVersion: 1 }), { status: 201 })
    if (url === '/api/v2/components/u1/versions') return new Response(JSON.stringify({ id: 'u1', name: 'Kendi kartım', currentVersion: 4 }))
    return new Response('{}', { status: 404 })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const draft = (over: Partial<ComponentDraftCard> = {}): ComponentDraftCard => ({ id: '3f2a9c1e-0000-4000-8000-000000000001', ok: true, name: 'Eylem kutusu', description: 'Adımlar', category: 'NOT_UYARI', definition: { schemaVersion: 1 }, issues: [], previewHtml: '<p>taslak</p>', ...over })
const msg = (drafts: ComponentDraftCard[]): ChatMessage => ({ id: 'a1', role: 'ASSISTANT', content: 'Eylem kutusu taslağı hazır.', status: 'COMPLETED', errorDetail: null, createdAt: '2026-10-17T20:00:00Z', context: { componentDrafts: drafts } })
const show = (drafts: ComponentDraftCard[]) => render(<MemoryRouter><ConversationMessages messages={[msg(drafts)]} isSending={false} activity={null} /></MemoryRouter>)

describe('sohbet mesajındaki bileşen taslağı kartı', () => {
  it('önizleme gösterir ve kullanıcı onayıyla taslak anahtarıyla havuza ekler', async () => {
    show([draft()])
    expect(screen.getByTitle('Eylem kutusu önizlemesi')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: 'Havuza ekle ve aktifleştir' }))
    await waitFor(() => expect(calls[0]).toMatchObject({ url: '/api/v2/components', method: 'POST', body: { key: 'ai-3f2a9c1e00', name: 'Eylem kutusu', origin: 'AI', activate: true } }))
    expect(await screen.findByText(/havuza eklendi ve aktifleştirildi/)).toBeInTheDocument()
  })

  it('ikinci kayıt "zaten kaydedildi" olarak gösterilir', async () => {
    duplicate = true
    show([draft()])
    await userEvent.click(screen.getByRole('button', { name: 'Pasif kaydet' }))
    expect(await screen.findByText('Bu taslak zaten havuza kaydedildi.')).toBeInTheDocument()
  })

  it('kullanıcı bileşeninin değişikliği yeni sürüm olur; yerleşik bileşeninki kopya olarak eklenir', async () => {
    show([draft({ id: 'd-user', name: 'Kendi kartım', target: { id: 'u1', key: 'kendi', name: 'Kendi kartım', version: 3, origin: 'AI' } }), draft({ id: 'd-builtin', name: 'Yürürlük (büyük tarih)', target: { id: 'b1', key: 'yururluk', name: 'Yürürlük', version: 1, origin: 'BUILTIN' } })])
    expect(screen.getByText(/yerleşik bileşen olduğu için kopya olarak eklenir/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Yeni sürüm olarak kaydet' }))
    await waitFor(() => expect(calls[0]).toMatchObject({ url: '/api/v2/components/u1/versions', method: 'POST', body: { name: 'Kendi kartım', note: 'Sohbetten değiştirildi' } }))
    expect(await screen.findByText(/sürüm 4 olarak kaydedildi/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Havuza ekle ve aktifleştir' })).toHaveLength(1)
  })
})
