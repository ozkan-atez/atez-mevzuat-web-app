import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import type { ChatModelClient, ChatStreamEvent } from './application/chat-model-client'
import type { ChatRepository } from './application/ports'
import type { AssistantKnowledge } from './application/assistant-knowledge'
import { MAX_MESSAGE_LENGTH, sendChatMessage } from './application/send-chat-message'

export interface ChatRouteOptions {
  repository: ChatRepository
  model: ChatModelClient
  modelName: string
  knowledge: AssistantKnowledge
}

const messageBodySchema = z.object({
  content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
}).strict()

export async function chatRoutes(app: FastifyInstance, options: ChatRouteOptions) {
  app.get('/sessions', async (_request, reply) => reply.send({ sessions: await options.repository.listHistory() }))

  app.post('/sessions', async (_request, reply) => reply.code(201).send(await options.repository.createSession()))

  app.get('/sessions/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!await options.repository.sessionExists(id)) return reply.code(404).send({ message: 'Sohbet bulunamadı.' })
    return reply.send({ sessionId: id, messages: await options.repository.getMessages(id) })
  })

  app.delete('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    return await options.repository.deleteSession(id)
      ? reply.code(204).send()
      : reply.code(404).send({ message: 'Sohbet bulunamadı.' })
  })

  app.post('/sessions/:id/messages', async (request, reply) => {
    const body = messageBodySchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ message: `Mesaj 1-${MAX_MESSAGE_LENGTH} karakter olmalıdır.` })
    const { id } = request.params as { id: string }
    if (!await options.repository.sessionExists(id)) return reply.code(404).send({ message: 'Sohbet bulunamadı.' })

    // The browser closing the tab must stop the provider call; otherwise the model
    // keeps generating an answer nobody will ever read.
    const controller = new AbortController()
    request.raw.once('close', () => controller.abort())

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    try {
      for await (const event of sendChatMessage(
        { sessionId: id, content: body.data.content, signal: controller.signal },
        { ...options, onFailure: (error) => request.log.error({ err: error }, 'Sohbet yanıtı tamamlanamadı') },
      )) {
        writeEvent(reply, event)
      }
    } finally {
      reply.raw.end()
    }
    return reply
  })
}

function writeEvent(reply: FastifyReply, event: ChatStreamEvent): void {
  reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}
