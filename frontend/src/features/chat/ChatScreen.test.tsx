import { StrictMode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { cleanup, render, screen, waitFor, within } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatScreen } from './ChatScreen'
import type { ChatHistoryItem } from './types'

const sent: string[] = []
let createdSessions = 0

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname}{location.search}</span>
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

function stubFetch(options: { history?: ChatHistoryItem[]; messages?: unknown[]; streamError?: string; networkError?: string } = {}) {
  sent.length = 0
  createdSessions = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST' && url.endsWith('/messages')) {
      if (options.networkError) throw new Error(options.networkError)
      sent.push(JSON.parse(String(init.body)).content)
      const frames = options.streamError ? [
        `event: error\ndata: ${JSON.stringify({ type: 'error', message: options.streamError })}\n\n`,
      ] : [
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
      return new Response(JSON.stringify({ id: `session-${createdSessions}`, title: null, createdAt: '', updatedAt: '' }), { status: 201 })
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
  it('shows report revision groups alongside general conversations', async () => {
    stubFetch({ history: [historyItem({}), historyItem({ id: 'thread-1', type: 'REPORT_REVISION', title: 'PET revizyonu', target: '/chat?report=topic-1' })] })
    renderChat('/chat/general-1')
    expect(await screen.findByRole('navigation', { name: 'Sohbet geçmişi' })).toBeVisible()
    await waitFor(() => expect(screen.getByRole('link', { name: /GTİP sorusu/ })).toBeVisible())
    const reports = screen.getByRole('region', { name: 'Rapor değişiklikleri' })
    const conversations = screen.getByRole('region', { name: 'Sohbetler' })
    expect(within(reports).getByRole('link', { name: /PET revizyonu/ })).toHaveAttribute('href', '/chat?report=topic-1')
    expect(within(conversations).getByRole('link', { name: /GTİP sorusu/ })).toHaveAttribute('aria-current', 'page')
    expect(within(reports).queryByRole('link', { name: /GTİP sorusu/ })).not.toBeInTheDocument()
    expect(within(conversations).queryByRole('link', { name: /PET revizyonu/ })).not.toBeInTheDocument()
    expect(reports.compareDocumentPosition(conversations) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('GTİP nedir?')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Rapor düzelt/ })).toBeVisible()
  })

  it('shows a streamed failure only once inside the conversation', async () => {
    const failure = 'Yapay zekâ hizmetine erişim reddedildi.'
    stubFetch({ streamError: failure })
    renderChat('/chat/general-1')
    await userEvent.type(await screen.findByRole('textbox', { name: 'Mesaj' }), 'Sor{Enter}')
    await waitFor(() => expect(screen.getAllByText(failure)).toHaveLength(1))
    expect(screen.getByRole('alert')).toHaveClass('ant-alert-error')
  })

  it('still shows a network failure when there is no failed message', async () => {
    const failure = 'Bağlantı kesildi.'
    stubFetch({ networkError: failure })
    renderChat('/chat/general-1')
    await userEvent.type(await screen.findByRole('textbox', { name: 'Mesaj' }), 'Sor{Enter}')
    expect(await screen.findByText(failure)).toBeVisible()
    expect(screen.getByRole('alert')).toHaveClass('atez-chat-error')
  })

  it('restores a stored transcript for an existing conversation', async () => {
    stubFetch({ messages: [message('u1', 'USER', 'Eski soru'), message('a1', 'ASSISTANT', 'Eski cevap')] })
    renderChat('/chat/general-1')

    expect(await screen.findByText('Eski soru')).toBeVisible()
    expect(screen.getByText('Eski cevap')).toBeVisible()
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

  it('creates one conversation, canonicalises the URL, and sends the handed-over message once', async () => {
    stubFetch()
    renderChat('/chat', { initialMessage: 'GTİP nedir?' }, { strict: true })

    await waitFor(() => expect(createdSessions).toBe(1))
    await waitFor(() => expect(sent).toEqual(['GTİP nedir?']))
    expect(screen.getByTestId('location')).toHaveTextContent('/chat/session-1')
  })

  it('preserves immutable document versions through the first-session handoff', async () => {
    stubFetch()
    renderChat('/chat', { initialMessage: 'Ekli belgeyi analiz et', documentVersionIds: ['immutable-v1'] }, { strict: true })
    await waitFor(() => expect(sent).toEqual(['Ekli belgeyi analiz et']))
    const calls = vi.mocked(fetch).mock.calls.filter(call => String(call[0]).endsWith('/messages') && call[1]?.method === 'POST')
    expect(calls).toHaveLength(1)
    expect(JSON.parse(String(calls[0]![1]!.body)).documentVersionIds).toEqual(['immutable-v1'])
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
      historyItem({ id: 'thread-1', type: 'REPORT_REVISION', title: 'PET revizyonu', target: '/chat?report=topic-1' }),
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
  it('can start another new conversation without retaining the old transcript', async () => {
    stubFetch()
    renderChat('/chat', { initialMessage: 'İlk soru' }, { strict: true })
    await waitFor(() => expect(sent).toEqual(['İlk soru']))
    await userEvent.click(screen.getByRole('link', { name: /Yeni sohbet/ }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'Mesaj' }), 'İkinci soru{Enter}')
    await waitFor(() => expect(sent).toEqual(['İlk soru', 'İkinci soru']))
    expect(createdSessions).toBe(2)
    expect(screen.getByTestId('location')).toHaveTextContent('/chat/session-2')
    expect(screen.queryByText('İlk soru')).not.toBeInTheDocument()
  })

  it('renders a readable message for a previously saved model failure', async () => {
    stubFetch({ messages: [{ ...message('f1', 'ASSISTANT', ''), status: 'FAILED', errorDetail: 'MODEL_GENERATION_FAILED' }] })
    renderChat('/chat/general-1')
    expect(await screen.findByText('Yapay zekâ yanıtı tamamlanamadı. Rapor sorgunuzu yeniden gönderebilirsiniz.')).toBeVisible()
    expect(screen.queryByText('MODEL_GENERATION_FAILED')).not.toBeInTheDocument()
  })

})

it('preserves selected sources and template in the first-message handoff', async () => {
  stubFetch()
  renderChat('/chat', {initialMessage: 'Kaynakları özetle', sourceIds: ['source-1'], templateId: 'template-1'}, {strict: true})
  await waitFor(() => expect(sent).toEqual(['Kaynakları özetle']))
  const post = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith('/messages') && init?.method === 'POST')
  expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({sourceIds: ['source-1'], templateId: 'template-1'})
})
