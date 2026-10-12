import { StrictMode } from 'react'
import { cleanup, render, screen, waitFor } from '../../test/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { Dashboard } from './Dashboard'
import { ChatScreen } from '../chat/ChatScreen'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.state ? ':pending' : ':cleared'}</output>
}
function setup(failCreateOnce = false) {
  const sent: string[] = []
  let created = 0
  let attempts = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/v1/chat/sessions' && init?.method === 'POST') {
      attempts++
      if (failCreateOnce && attempts === 1) return new Response(JSON.stringify({ message: 'Sohbet servisi geçici olarak kullanılamıyor.' }), { status: 503 })
      created++
      return new Response(JSON.stringify({ id: `session-${created}`, title: null }), { status: 201 })
    }
    if (url.endsWith('/messages') && init?.method === 'POST') {
      // Real fetch honours StrictMode cleanup; an already aborted handoff cannot succeed.
      await new Promise(resolve => setTimeout(resolve, 0))
      if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const content = JSON.parse(String(init.body)).content
      sent.push(content)
      const message = { id: 'u1', role: 'USER', content, status: 'COMPLETED', errorDetail: null, createdAt: new Date().toISOString() }
      const reply = { ...message, id: 'a1', role: 'ASSISTANT', content: 'Sohbet hazır.' }
      return new Response(`data: ${JSON.stringify({ type: 'message', message })}\n\ndata: ${JSON.stringify({ type: 'complete', message: reply })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    }
    if (url.endsWith('/messages')) return new Response(JSON.stringify({ messages: [] }))
    if (url.startsWith('/api/v1/scan-runs/schedule')) return new Response(JSON.stringify({ slots: [] }))
    if (url.startsWith('/api/v1/scan-runs')) return new Response(JSON.stringify({ runs: [] }))
    return new Response(JSON.stringify({ sessions: [] }))
  }))
  render(<StrictMode><MemoryRouter><Routes>
    <Route path="/" element={<Dashboard />} />
    <Route path="/chat/:sessionId" element={<><ChatScreen /><LocationProbe /></>} />
  </Routes></MemoryRouter></StrictMode>)
  return { sent, created: () => created }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('Dashboard starts a new conversation', () => {
  it('creates one session and sends the prompt once under StrictMode and double clicks', async () => {
    const state = setup()
    await userEvent.type(screen.getByRole('textbox', { name: 'Asistana rapor talimatı' }), '  GTİP nedir?  ')
    await userEvent.dblClick(screen.getByRole('button', { name: /Başla/ }))
    await waitFor(() => expect(state.sent).toEqual(['GTİP nedir?']))
    expect(state.created()).toBe(1)
    expect(await screen.findByText('Sohbet hazır.')).toBeVisible()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/chat/session-1:cleared'))
  })
  it('sends with Enter', async () => {
    const state = setup()
    await userEvent.type(screen.getByRole('textbox', { name: 'Asistana rapor talimatı' }), 'İthalat belgeleri{Enter}')
    await waitFor(() => expect(state.sent).toEqual(['İthalat belgeleri']))
    expect(state.created()).toBe(1)
  })
  it('opens a persisted empty session without sending the placeholder as a message', async () => {
    const state = setup()
    await userEvent.click(screen.getByRole('button', { name: /Başla/ }))
    expect(await screen.findByTestId('location')).toHaveTextContent('/chat/session-1:cleared')
    expect(state.created()).toBe(1); expect(state.sent).toEqual([])
    expect(screen.getByRole('textbox', { name: 'Mesaj' })).toBeVisible()
  })
  it('preserves the prompt on a creation error and lets the user retry', async () => {
    const state = setup(true)
    await userEvent.type(screen.getByRole('textbox', { name: 'Asistana rapor talimatı' }), 'GTİP nedir?')
    await userEvent.click(screen.getByRole('button', { name: /Başla/ }))
    expect(await screen.findByText('Sohbet servisi geçici olarak kullanılamıyor.')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Asistana rapor talimatı' })).toHaveValue('GTİP nedir?')
    await userEvent.click(screen.getByRole('button', { name: /Başla/ }))
    await waitFor(() => expect(state.sent).toEqual(['GTİP nedir?']))
    expect(state.created()).toBe(1)
  })
})
