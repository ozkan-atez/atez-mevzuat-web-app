import { describe, expect, it } from 'vitest'
import { parseChatEventStream } from './api'
import type { ChatStreamEvent } from './types'

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

async function collect(events: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const collected: ChatStreamEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

describe('parseChatEventStream', () => {
  it('parses frames that network chunks split apart or bundle together', async () => {
    const response = streamResponse([
      'event: message\ndata: {"type":"message","message":{"id":"u1","role":"USER","content":"Merhaba","status":"COMPLETED","errorDetail":null,"createdAt":"2026-09-15T10:00:00.000Z"}}\n',
      '\nevent: delta\ndata: {"type":"delta","content":"Merha"}\n\nevent: delta\ndata: {"type":"delta","content":"ba"}\n\n',
      'event: complete\ndata: {"type":"complete","message":{"id":"a1","role":"ASSISTANT","content":"Merhaba","status":"COMPLETED","errorDetail":null,"createdAt":"2026-09-15T10:00:01.000Z"}}\n\n',
    ])

    expect(await collect(parseChatEventStream(response))).toMatchObject([
      { type: 'message' },
      { type: 'delta', content: 'Merha' },
      { type: 'delta', content: 'ba' },
      { type: 'complete' },
    ])
  })

  it('surfaces a multi-byte character split across two chunks intact', async () => {
    const frame = 'event: delta\ndata: {"type":"delta","content":"ğ"}\n\n'
    const bytes = new TextEncoder().encode(frame)
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        // "ğ" is two bytes; the split lands between them.
        controller.enqueue(bytes.slice(0, 40))
        controller.enqueue(bytes.slice(40))
        controller.close()
      },
    }))

    expect(await collect(parseChatEventStream(response))).toEqual([{ type: 'delta', content: 'ğ' }])
  })

  it('raises the server message for a failed response', async () => {
    const response = new Response(JSON.stringify({ message: 'Sohbet bulunamadı.' }), { status: 404 })

    await expect(collect(parseChatEventStream(response))).rejects.toMatchObject({ status: 404, message: 'Sohbet bulunamadı.' })
  })
})
