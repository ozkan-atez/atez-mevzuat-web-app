import type { BrowserResearch } from './application/browser-research'
import { installLocalWorkspaceBoundary } from '../../platform/local-workspace-access'
import type { ChatOperations } from './application/chat-operations'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import type { ChatModelClient, ChatStreamEvent } from './application/chat-model-client'
import type { ChatRepository } from './application/ports'
import type { AssistantKnowledge } from './application/assistant-knowledge'
import type { ChatScanStarter } from './application/chat-tools'
import { MAX_MESSAGE_LENGTH, sendChatMessage } from './application/send-chat-message'
import type { TariffLookup } from '../tariff/tariff-lookup'

export interface ChatRouteOptions {
  browserResearch?:BrowserResearch
  repository: ChatRepository
  model: ChatModelClient
  modelName: string
  knowledge: AssistantKnowledge
  scanStarter: ChatScanStarter
  tariffLookup?: TariffLookup | undefined
  operations?: ChatOperations | undefined
}

const messageBodySchema = z.object({
  browserAgent:z.boolean().optional(),
  webSearch:z.boolean().optional(),
  content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  documentVersionIds: z.array(z.string().uuid()).max(10).default([]),
  operationMode: z.enum(['REUSE_ONLY', 'FILL_MISSING', 'FORCE']).optional(),
}).strict()

export async function chatRoutes(app: FastifyInstance, options: ChatRouteOptions) {
  if(options.operations)installLocalWorkspaceBoundary(app)
  app.get('/reports', async (request, reply) => {
    const parsed = z.object({ query: z.string().trim().max(200).optional() }).safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ message: 'Geçerli bir rapor araması girin.' })
    const reports = await options.knowledge.searchReports({ ...(parsed.data.query ? { query: parsed.data.query } : {}), limit: 50 })
    return { reports: reports.filter(report => report.version > 0 && report.revisionEditable !== false).map(({ topicId, title, version, gazetteDate }) => ({ topicId, title, version, gazetteDate })) }
  })

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

    if(body.data.browserAgent&&body.data.webSearch)return reply.code(400).send({message:'Bir araştırma aracı seçin.'})
    if((body.data.webSearch||body.data.browserAgent) && body.data.documentVersionIds.length)return reply.code(400).send({message:'Web araması için ekli belgeleri kaldırın; özel belge içeriği arama sorgusuna eklenmez.'})
    for (const versionId of new Set(body.data.documentVersionIds)) {
      if (!await options.knowledge.getArchiveDocumentVersion?.({ versionId })) return reply.code(404).send({ message: 'Seçilen belge sürümü bulunamadı veya erişilemiyor.' })
    }

    // The browser closing the tab must stop the provider call; otherwise the model
    // keeps generating an answer nobody will ever read.
    const controller = new AbortController()
    reply.raw.once('close', () => { if (!reply.raw.writableEnded) controller.abort() })

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    let checking = false
    const sessionTimer = request.assertSessionActive ? setInterval(async () => {
      if (checking || controller.signal.aborted || reply.raw.writableEnded) return
      checking = true
      try { await request.assertSessionActive!() }
      catch {
        controller.abort()
        if (!reply.raw.writableEnded) { writeEvent(reply, { type: 'error', message: 'Oturum veya erişim izni sona erdi.' }); reply.raw.end() }
      } finally { checking = false }
    }, 3000) : null
    try {
      for await (const event of sendChatMessage(
        { sessionId: id, content: body.data.content, ...(body.data.webSearch?{webSearch:true}:{}), ...(body.data.browserAgent?{browserAgent:true}:{}), documentVersionIds: body.data.documentVersionIds, ...(body.data.operationMode ? { operationMode: body.data.operationMode } : {}), signal: controller.signal },
        { ...options, onFailure: (error) => request.log.error({ err: error }, 'Sohbet yanıtı tamamlanamadı') },
      )) {
        if (controller.signal.aborted || reply.raw.writableEnded) break
        writeEvent(reply, event)
      }
    } finally {
      if (sessionTimer) clearInterval(sessionTimer)
      reply.raw.end()
    }
    return reply
  })
}

function writeEvent(reply: FastifyReply, event: ChatStreamEvent): void {
  reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}
