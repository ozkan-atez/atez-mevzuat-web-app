import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useConversation } from './useConversation'

const sent: string[] = []

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  }), { status: 200 })
}

function message(id: string, role: 'USER' | 'ASSISTANT', content: string) {
  return { id, role, content, status: 'COMPLETED', errorDetail: null, createdAt: '2026-09-15T10:00:00.000Z' }
}

function frame(event: unknown, name: string): string {
  return `event: ${name}\ndata: ${JSON.stringify(event)}\n\n`
}

function stubFetch(options: { stream?: string[]; existing?: unknown[] } = {}) {
  sent.length = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST') {
      sent.push(JSON.parse(String(init.body)).content)
      return sseResponse(options.stream ?? [
        frame({ type: 'message', message: message('u1', 'USER', 'Merhaba') }, 'message'),
        frame({ type: 'delta', content: 'Merhaba' }, 'delta'),
        frame({ type: 'delta', content: ' dünya' }, 'delta'),
        frame({ type: 'complete', message: message('a1', 'ASSISTANT', 'Merhaba dünya') }, 'complete'),
      ])
    }
    if (url.includes('/messages')) return new Response(JSON.stringify({ messages: options.existing ?? [] }), { status: 200 })
    return new Response('{}', { status: 200 })
  }))
}

afterEach(() => vi.unstubAllGlobals())

describe('useConversation', () => {
  it('loads an existing transcript for the session', async () => {
    stubFetch({ existing: [message('u1', 'USER', 'Eski soru'), message('a1', 'ASSISTANT', 'Eski cevap')] })
    const { result } = renderHook(() => useConversation('s1'))

    await waitFor(() => expect(result.current.messages).toHaveLength(2))
    expect(result.current.messages.map((item) => item.content)).toEqual(['Eski soru', 'Eski cevap'])
  })

  it('shows the user immediately and builds one assistant bubble from deltas', async () => {
    stubFetch()
    const { result } = renderHook(() => useConversation('s1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(() => result.current.send('Merhaba'))

    expect(result.current.messages.map((item) => item.content)).toEqual(['Merhaba', 'Merhaba dünya'])
    expect(result.current.isSending).toBe(false)
  })

  it('keeps a message sent into a brand new conversation when the empty transcript arrives late', async () => {
    let releaseLoad = () => {}
    const pending = new Promise<void>((resolve) => { releaseLoad = resolve })
    sent.length = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        sent.push(JSON.parse(String(init.body)).content)
        return sseResponse([
          frame({ type: 'message', message: message('u1', 'USER', 'Merhaba') }, 'message'),
          frame({ type: 'complete', message: message('a1', 'ASSISTANT', 'Merhaba dünya') }, 'complete'),
        ])
      }
      // The transcript of a session created a moment ago: still empty, and slow.
      await pending
      return new Response(JSON.stringify({ messages: [] }), { status: 200 })
    }))
    const { result } = renderHook(() => useConversation('s1'))

    await act(() => result.current.send('Merhaba'))
    await act(async () => { releaseLoad(); await Promise.resolve() })

    expect(result.current.messages.map((item) => item.content)).toEqual(['Merhaba', 'Merhaba dünya'])
  })

  it('shows what the assistant is looking up until the words start arriving', async () => {
    stubFetch({ stream: [
      frame({ type: 'message', message: message('u1', 'USER', 'Hangi rapor?') }, 'message'),
      frame({ type: 'tool', name: 'raporlari_ara', label: 'Bültenlerde arıyor' }, 'tool'),
      frame({ type: 'delta', content: 'Bulundu' }, 'delta'),
      frame({ type: 'complete', message: message('a1', 'ASSISTANT', 'Bulundu') }, 'complete'),
    ] })
    const { result } = renderHook(() => useConversation('s1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(() => result.current.send('Hangi rapor?'))

    expect(result.current.activity).toBeNull()
    expect(result.current.messages.map((item) => item.content)).toEqual(['Hangi rapor?', 'Bulundu'])
  })

  it('ignores a second send while a response is still streaming', async () => {
    stubFetch()
    const { result } = renderHook(() => useConversation('s1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => { await Promise.all([result.current.send('Birinci'), result.current.send('İkinci')]) })

    expect(sent).toEqual(['Birinci'])
  })

  it('rejects empty and over-limit input before touching the network', async () => {
    stubFetch()
    const { result } = renderHook(() => useConversation('s1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(() => result.current.send('   '))
    await act(() => result.current.send('x'.repeat(8_001)))

    expect(sent).toEqual([])
  })

  it('marks the answer failed and exposes a readable error', async () => {
    stubFetch({ stream: [
      frame({ type: 'message', message: message('u1', 'USER', 'Sor') }, 'message'),
      frame({ type: 'error', message: 'Yapay zekâ yanıtı tamamlanamadı. Lütfen yeniden deneyin.' }, 'error'),
    ] })
    const { result } = renderHook(() => useConversation('s1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(() => result.current.send('Sor'))

    expect(result.current.error).toBe('Yapay zekâ yanıtı tamamlanamadı. Lütfen yeniden deneyin.')
    expect(result.current.messages.at(-1)).toMatchObject({ role: 'ASSISTANT', status: 'FAILED' })
  })
})
