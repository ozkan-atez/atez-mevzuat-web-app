import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import type { ChatModelClient, ChatStreamEvent } from './application/chat-model-client'
import type { ChatRepository } from './application/ports'
import type { AssistantKnowledge } from './application/assistant-knowledge'
import { MAX_MESSAGE_LENGTH, sendChatMessage } from './application/send-chat-message'
import { decodeChatAttachment } from './application/chat-attachment'
import { generateChatTitle } from './application/generate-chat-title'

export interface ChatRouteOptions {
  repository: ChatRepository
  model: ChatModelClient
  modelName: string
  knowledge: AssistantKnowledge
  startRun?: (input: { targetDate: string; requestKey: string }) => Promise<{ id: string; status: string; targetDate: string }>
  createTemplate?: (input: { request: string; preset: 'executive' | 'detailed' | 'empty-day' }) => Promise<{ id: string; name: string }>
  listTemplates?: () => Promise<Array<{ id: string; name: string; description: string | null }>>
}

const messageBodySchema = z.object({
  content: z.string().trim().max(MAX_MESSAGE_LENGTH),
  attachment: z.object({ name: z.string(), mediaType: z.string(), data: z.string() }).strict().optional(),
}).strict().refine((value) => value.content.length > 0 || Boolean(value.attachment))

export async function chatRoutes(app: FastifyInstance, options: ChatRouteOptions) {
  const titlesInProgress = new Set<string>()
  const startTitle = (input: { sessionId: string; userMessage: string; assistantMessage: string; expectedTitle?: string | null }, log: FastifyInstance['log']) => {
    if (titlesInProgress.has(input.sessionId)) return
    titlesInProgress.add(input.sessionId)
    void generateChatTitle({ ...input, repository: options.repository, model: options.model, modelName: options.modelName })
      .catch((error: unknown) => log.warn({ err: error }, 'Sohbet başlığı oluşturulamadı'))
      .finally(() => titlesInProgress.delete(input.sessionId))
  }

  app.get('/sessions', async (request, reply) => {
    const sessions = await options.repository.listHistory()
    for (const item of sessions.filter((entry) => entry.type === 'GENERAL' && entry.titlePending && entry.messageCount >= 1).slice(0, 5)) {
      if (titlesInProgress.has(item.id)) continue
      titlesInProgress.add(item.id)
      void options.repository.getMessages(item.id)
        .then(async (messages) => {
          const user = messages.find((message) => message.role === 'USER')
          const assistant = messages.find((message) => message.role === 'ASSISTANT' && message.status === 'COMPLETED')
          if (user) await generateChatTitle({ sessionId: item.id, userMessage: user.content, assistantMessage: assistant?.content ?? '', expectedTitle: await options.repository.getSessionTitle(item.id), repository: options.repository, model: options.model, modelName: options.modelName })
        })
        .catch((error: unknown) => request.log.warn({ err: error }, 'Eski sohbet başlığı oluşturulamadı'))
        .finally(() => titlesInProgress.delete(item.id))
    }
    return reply.send({ sessions })
  })

  app.post('/sessions', async (_request, reply) => reply.code(201).send(await options.repository.createSession()))

  app.get('/sessions/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!await options.repository.sessionExists(id)) return reply.code(404).send({ message: 'Sohbet bulunamadı.' })
    return reply.send({ sessionId: id, messages: await options.repository.getMessages(id) })
  })

  app.get('/sessions/:id/attachments/:attachmentId', async (request, reply) => {
    const { id, attachmentId } = request.params as { id: string; attachmentId: string }
    const attachment = await options.repository.getAttachment?.(id, attachmentId)
    if (!attachment) return reply.code(404).send({ message: 'Dosya bulunamadı.' })
    reply.header('Content-Type', attachment.mediaType)
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`)
    reply.header('X-Content-Type-Options', 'nosniff')
    return reply.send(attachment.bytes)
  })

  app.delete('/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    return await options.repository.deleteSession(id)
      ? reply.code(204).send()
      : reply.code(404).send({ message: 'Sohbet bulunamadı.' })
  })

  app.post('/sessions/:id/messages', { bodyLimit: 7_500_000 }, async (request, reply) => {
    const body = messageBodySchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ message: `Mesaj 1-${MAX_MESSAGE_LENGTH} karakter olmalıdır.` })
    const { id } = request.params as { id: string }
    if (!await options.repository.sessionExists(id)) return reply.code(404).send({ message: 'Sohbet bulunamadı.' })
    let attachment
    try {
      attachment = body.data.attachment ? decodeChatAttachment(body.data.attachment) : undefined
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : 'Dosya okunamadı.' })
    }

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
    const userMessage = body.data.content || `Bu dosyayı incele: ${attachment!.name}`
    try {
      for await (const event of sendChatMessage(
        { sessionId: id, content: userMessage, ...(attachment ? { attachment } : {}), signal: controller.signal },
        { ...options, onFailure: (error) => request.log.error({ err: error }, 'Sohbet yanıtı tamamlanamadı') },
      )) {
        writeEvent(reply, event)
        if (event.type === 'complete') startTitle({ sessionId: id, userMessage, assistantMessage: event.message.content }, request.log)
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
