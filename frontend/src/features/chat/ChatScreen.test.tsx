import { StrictMode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatScreen } from './ChatScreen'
import type { ChatHistoryItem } from './types'

const sent: string[] = []
let createdSessions = 0

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}</span>
}

function message(id: string, role: 'USER' | 'ASSISTANT', content: string) {
  return { id, role, content, status: 'COMPLETED', errorDetail: null, createdAt: '2026-09-15T10:00:00.000Z' }
}

function historyItem(overrides: Partial<ChatHistoryItem>): ChatHistoryItem {
  return {
    id: 'general-1', type: 'GENERAL', title: 'GTİP sorusu', preview: 'GTİP nedir?',
    messageCount: 2, updatedAt: '2026-09-15T10:00:00.000Z', target: '/chat/general-1', ...overrides,
  }
}

function stubFetch(options: { history?: ChatHistoryItem[]; messages?: unknown[] } = {}) {
  sent.length = 0
  createdSessions = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST' && url.endsWith('/messages')) {
      sent.push(JSON.parse(String(init.body)).content)
      const frames = [
        `event: message\ndata: ${JSON.stringify({ type: 'message', message: message('u1', 'USER', sent.at(-1)!) })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ type: 'delta', content: 'Yanıt' })}\n\n`,
        `event: complete\ndata: ${JSON.stringify({ type: 'complete', message: message('a1', 'ASSISTANT', 'Yanıt') })}\n\n`,
      ]
      const encoder = new TextEncoder()
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          for (const frame of frames) controller.enqueue(encoder.encode(frame))
          controller.close()
        },
      }), { status: 200 })
    }
    if (init?.method === 'POST') {
      createdSessions += 1
      return new Response(JSON.stringify({ id: 'session-1', title: null, createdAt: '', updatedAt: '' }), { status: 201 })
    }
    if (init?.method === 'DELETE') return new Response(null, { status: 204 })
    if (url.endsWith('/messages')) return new Response(JSON.stringify({ messages: options.messages ?? [] }), { status: 200 })
    return new Response(JSON.stringify({ sessions: options.history ?? [] }), { status: 200 })
  }))
}

function renderChat(path: string, state?: unknown, options: { strict?: boolean } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/chat" element={<><ChatScreen /><LocationProbe /></>} />
        <Route path="/chat/:sessionId" element={<><ChatScreen /><LocationProbe /></>} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  )
  return render(options.strict ? <StrictMode>{tree}</StrictMode> : tree)
}

beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('ChatScreen', () => {
  it('groups report threads by run while keeping general chats separate', async () => {
    stubFetch({ history: [
      historyItem({}),
      historyItem({ id: 'thread-1', type: 'REPORT_REVISION', title: 'PET revizyonu', target: '/reports/topic-1', run: { id: 'run-1', targetDate: '2026-09-11T00:00:00.000Z' } }),
      historyItem({ id: 'thread-2', type: 'REPORT_REVISION', title: 'Tarife revizyonu', target: '/reports/topic-2', run: { id: 'run-1', targetDate: '2026-09-11T00:00:00.000Z' } }),
      historyItem({ id: 'thread-3', type: 'REPORT_REVISION', title: 'İhracat revizyonu', target: '/reports/topic-3', run: { id: 'run-2', targetDate: '2026-09-12T00:00:00.000Z' } }),
    ] })
    renderChat('/chat/general-1')

    expect(await screen.findByRole('navigation', { name: 'Sohbet geçmişi' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'GTİP sorusu' })).toBeVisible()
    expect(screen.queryByRole('link', { name: 'PET revizyonu' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /11 Eyl 2026 · run-1 taramasının rapor sohbetleri/i }))
    expect(screen.getByRole('link', { name: 'PET revizyonu' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Tarife revizyonu' })).toBeVisible()
    expect(screen.queryByRole('link', { name: 'İhracat revizyonu' })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('link', { name: /PET revizyonu/ }))

    expect(screen.getByTestId('location')).toHaveTextContent('/reports/topic-1')
  })

  it('restores a stored transcript for an existing conversation', async () => {
    stubFetch({ messages: [message('u1', 'USER', 'Eski soru'), message('a1', 'ASSISTANT', 'Eski cevap')] })
    renderChat('/chat/general-1')

    expect(await screen.findByText('Eski soru')).toBeVisible()
    expect(screen.getByText('Eski cevap')).toBeVisible()
  })

  it('offers retry for a previously saved empty assistant reply', async () => {
    stubFetch({ messages: [message('u1', 'USER', 'Rapor bağlantısı?'), message('a1', 'ASSISTANT', '')] })
    renderChat('/chat/general-1')

    expect(await screen.findByText('Bu soruya yanıt oluşturulamadı.')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }))
    await waitFor(() => expect(sent).toEqual(['Rapor bağlantısı?']))
  })

  it('sends with Enter and inserts a newline with Shift+Enter', async () => {
    stubFetch()
    renderChat('/chat/general-1')
    const composer = await screen.findByRole('textbox', { name: 'Mesaj' })

    await userEvent.type(composer, 'Birinci satır{Shift>}{Enter}{/Shift}İkinci satır')
    expect(composer).toHaveValue('Birinci satır\nİkinci satır')

    await userEvent.type(composer, '{Enter}')
    await waitFor(() => expect(sent).toEqual(['Birinci satır\nİkinci satır']))
  })

  it('sends an attached text file through the docked composer', async () => {
    stubFetch()
    const fetchMock = vi.mocked(globalThis.fetch)
    renderChat('/chat/general-1')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Dosya ekle' }))
    await user.upload(screen.getByLabelText('Sohbete dosya seç'), new File(['Tarife notu'], 'tarife.txt', { type: 'text/plain' }))
    await user.type(screen.getByRole('textbox', { name: 'Mesaj' }), 'Bu dosyada ne yazıyor?{Enter}')
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/messages') && init?.method === 'POST' && JSON.parse(String(init.body)).attachment?.name === 'tarife.txt')).toBe(true))
  })

  it('creates one conversation, canonicalises the URL, and sends the handed-over message once', async () => {
    stubFetch()
    renderChat('/chat', { initialMessage: 'GTİP nedir?' }, { strict: true })

    await waitFor(() => expect(createdSessions).toBe(1))
    await waitFor(() => expect(sent).toEqual(['GTİP nedir?']))
    expect(screen.getByTestId('location')).toHaveTextContent('/chat/session-1')
  })

  it('preserves the selected file while creating a conversation', async () => {
    stubFetch()
    const fetchMock = vi.mocked(globalThis.fetch)
    renderChat('/chat', { initialMessage: 'Eki incele', initialFile: new File(['İthalat'], 'ek.txt', { type: 'text/plain' }) }, { strict: true })
    await waitFor(() => expect(createdSessions).toBe(1))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/messages') && init?.method === 'POST' && JSON.parse(String(init.body)).attachment?.name === 'ek.txt')).toBe(true))
  })

  it('starts a conversation when the first message is typed on the empty state', async () => {
    stubFetch()
    renderChat('/chat')

    await userEvent.type(await screen.findByRole('textbox', { name: 'Mesaj' }), 'GTİP nedir?{Enter}')

    await waitFor(() => expect(createdSessions).toBe(1))
    await waitFor(() => expect(sent).toEqual(['GTİP nedir?']))
    expect(screen.getByTestId('location')).toHaveTextContent('/chat/session-1')
  })

  it('deletes a general conversation after confirmation and leaves report threads alone', async () => {
    stubFetch({ history: [
      historyItem({}),
      historyItem({ id: 'thread-1', type: 'REPORT_REVISION', title: 'PET revizyonu', target: '/reports/topic-1' }),
    ] })
    renderChat('/chat/general-1')

    expect(await screen.findByRole('button', { name: 'GTİP sorusu sohbetini sil' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'PET revizyonu sohbetini sil' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'GTİP sorusu sohbetini sil' }))

    await waitFor(() => expect(screen.queryByRole('link', { name: /GTİP sorusu/ })).not.toBeInTheDocument())
  })

  it('opens the history as a drawer on narrow screens', async () => {
    stubFetch({ history: [historyItem({})] })
    renderChat('/chat/general-1')

    await userEvent.click(await screen.findByRole('button', { name: 'Sohbet geçmişini aç' }))

    expect(screen.getAllByRole('navigation', { name: 'Sohbet geçmişi' })).toHaveLength(2)
    await userEvent.click(screen.getAllByRole('button', { name: 'Geçmişi kapat' })[0]!)
    await waitFor(() => expect(screen.getAllByRole('navigation', { name: 'Sohbet geçmişi' })).toHaveLength(1))
  })
})
