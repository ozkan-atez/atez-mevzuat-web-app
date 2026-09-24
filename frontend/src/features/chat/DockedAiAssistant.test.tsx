import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DockedAiAssistant } from './DockedAiAssistant'
import { ActiveReportProvider, useRegisterActiveReport } from '../revision/ActiveReportContext'
import { ActiveTemplateProvider, useRegisterActiveTemplate } from '../templates/ActiveTemplateContext'
import { AppLayout } from '../../components/layout/AppLayout'
import { ChatScreen } from './ChatScreen'

function LocationProbe() {
  const location = useLocation()
  return (
    <>
      <span data-testid="location">{location.pathname}</span>
      <span data-testid="location-state">{JSON.stringify(location.state ?? {})}</span>
    </>
  )
}

function AssistantHarness({ startOpen = false }: { startOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(startOpen)
  return <DockedAiAssistant isOpen={isOpen} onOpenChange={setIsOpen} />
}

function RegisterReport({ submitPrompt }: { submitPrompt: (message: string) => Promise<void> }) {
  useRegisterActiveReport({ topicId: 'topic-1', title: 'İthalat Tebliği', submitPrompt, isPrompting: false })
  return null
}

function RegisterTemplate({ submitPrompt }: { submitPrompt: (message: string) => Promise<void> }) {
  useRegisterActiveTemplate({ submitPrompt, isPrompting: false })
  return null
}

function renderAssistant(options: { path?: string; report?: (message: string) => Promise<void> } = {}) {
  return render(
    <MemoryRouter initialEntries={[options.path ?? '/']}>
      <ActiveReportProvider>
        {options.report && <RegisterReport submitPrompt={options.report} />}
        <AssistantHarness startOpen />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </ActiveReportProvider>
    </MemoryRouter>,
  )
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('DockedAiAssistant', () => {
  it('opens from the compact bottom-center launcher and returns to it when closed', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><AssistantHarness /></MemoryRouter>)

    const launcher = screen.getByRole('button', { name: 'Yapay zekâ asistanını aç' })
    expect(launcher).toBeVisible()
    expect(launcher.closest('aside')).toHaveClass('left-1/2', '-translate-x-1/2')
    expect(screen.queryByPlaceholderText('Ne değiştirmek veya oluşturmak istiyorsunuz?')).not.toBeInTheDocument()

    await user.click(launcher)

    expect(screen.getByPlaceholderText('Ne değiştirmek veya oluşturmak istiyorsunuz?')).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Yapay zekâ asistanını kapat' }))

    expect(screen.getByRole('button', { name: 'Yapay zekâ asistanını aç' })).toBeVisible()
  })

  it('returns to the compact launcher after five seconds without use', () => {
    vi.useFakeTimers()
    render(<MemoryRouter><AssistantHarness startOpen /></MemoryRouter>)

    expect(screen.getByRole('textbox', { name: 'Mesaj' })).toBeVisible()
    act(() => vi.advanceTimersByTime(4_999))
    expect(screen.getByRole('textbox', { name: 'Mesaj' })).toBeVisible()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('button', { name: 'Yapay zekâ asistanını aç' })).toBeVisible()
  })

  it('keeps an unfinished message open past the inactivity timeout', () => {
    vi.useFakeTimers()
    render(<MemoryRouter><AssistantHarness startOpen /></MemoryRouter>)
    const input = screen.getByRole('textbox', { name: 'Mesaj' })

    fireEvent.change(input, { target: { value: 'Soru' } })
    act(() => vi.advanceTimersByTime(6_000))
    expect(screen.getByRole('textbox', { name: 'Mesaj' })).toBeVisible()
  })

  it('carries a question from the dashboard into the chat workspace', async () => {
    const user = userEvent.setup()
    renderAssistant()

    await user.type(screen.getByPlaceholderText('Ne değiştirmek veya oluşturmak istiyorsunuz?'), 'GTİP nedir?{enter}')

    expect(screen.getByTestId('location')).toHaveTextContent('/chat')
    expect(screen.getByTestId('location-state')).toHaveTextContent('GTİP nedir?')
  })

  it('adds a file with the plus button and carries it into chat', async () => {
    const user = userEvent.setup()
    renderAssistant()
    await user.click(screen.getByRole('button', { name: 'Dosya ekle' }))
    await user.upload(screen.getByLabelText('Sohbete dosya seç'), new File(['Tarife notu'], 'tarife.txt', { type: 'text/plain' }))
    expect(screen.getByText('tarife.txt')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Gönder' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/chat')
    expect(screen.getByTestId('location-state')).toHaveTextContent('tarife.txt')
  })

  it('keeps a prompt on the report page as a revision request', async () => {
    const user = userEvent.setup()
    const submitPrompt = vi.fn(async () => undefined)
    renderAssistant({ path: '/reports/topic-1', report: submitPrompt })

    await user.type(screen.getByPlaceholderText(/için revizyon isteyin/), 'Başlığı kısalt{enter}')

    expect(submitPrompt).toHaveBeenCalledWith('Başlığı kısalt')
    expect(screen.getByTestId('location')).toHaveTextContent('/reports/topic-1')
  })

  it('applies a template prompt without navigating to chat', async () => {
    const submitPrompt = vi.fn(async () => undefined)
    render(<MemoryRouter initialEntries={['/templates']}><ActiveTemplateProvider><RegisterTemplate submitPrompt={submitPrompt} /><AssistantHarness startOpen /><Routes><Route path="*" element={<LocationProbe />} /></Routes></ActiveTemplateProvider></MemoryRouter>)
    await userEvent.type(screen.getByPlaceholderText('Şablonda ne oluşturmak veya değiştirmek istiyorsunuz?'), 'Özet kartı ekle{enter}')
    expect(submitPrompt).toHaveBeenCalledWith('Özet kartı ekle')
    expect(screen.getByTestId('location')).toHaveTextContent('/templates')
  })

  it('moves a home message into chat and allows a second new conversation', async () => {
    const sent: string[] = []
    let created = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST' && url.endsWith('/messages')) {
        const content = JSON.parse(String(init.body)).content as string
        sent.push(content)
        const frame = `event: complete\ndata: ${JSON.stringify({ type: 'complete', message: { id: `reply-${sent.length}`, role: 'ASSISTANT', content: 'Yanıt', status: 'COMPLETED', errorDetail: null, createdAt: '' } })}\n\n`
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode(frame))
          controller.close()
        } }), { status: 200 })
      }
      if (init?.method === 'POST') {
        created += 1
        return new Response(JSON.stringify({ id: `session-${created}`, title: null, createdAt: '', updatedAt: '' }), { status: 201 })
      }
      if (url.endsWith('/messages')) return new Response(JSON.stringify({ messages: [] }), { status: 200 })
      return new Response(JSON.stringify({ sessions: [] }), { status: 200 })
    }))

    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<p>Ana sayfa</p>} />
            <Route path="chat" element={<ChatScreen />} />
            <Route path="chat/:sessionId" element={<ChatScreen />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Yapay zekâ asistanını aç' }))
    await user.type(screen.getByRole('textbox', { name: 'Mesaj' }), 'GTİP nedir?{enter}')

    await waitFor(() => expect(sent).toEqual(['GTİP nedir?']))
    expect(created).toBe(1)
    expect(screen.getByRole('navigation', { name: 'Sohbet geçmişi' })).toBeVisible()
    expect(screen.getAllByRole('textbox', { name: 'Mesaj' })).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: 'Mesaj' }).closest('[data-purpose]')).toHaveAttribute('data-purpose', 'docked-copilot-bar')

    await user.click(screen.getByRole('link', { name: 'Yeni sohbet' }))
    await user.type(screen.getByRole('textbox', { name: 'Mesaj' }), 'Yeni soru{enter}')

    await waitFor(() => expect(sent).toEqual(['GTİP nedir?', 'Yeni soru']))
    expect(created).toBe(2)
  })
})
