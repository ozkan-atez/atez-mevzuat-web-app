import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { idempotencyKeySchema } from '../scan-runs/scan-runs.schemas'
import type { TopicObjectStore } from './application/ports'
import { classifyRevisionKind } from './application/build-revision-context'
import {
  PrismaTopicAnalysisRepository,
  TopicCommandConflictError,
  TopicNotFoundError,
  TopicRetryConflictError,
} from './infrastructure/prisma-topic-analysis-repository'

interface Options {
  repository: PrismaTopicAnalysisRepository
  objectStore?: Pick<TopicObjectStore, 'getContent'>
}

const messageSchema = z.object({ message: z.string().trim().min(1).max(8_000) }).strict()
const versionSchema = z.coerce.number().int().positive()

export async function topicAnalysisRoutes(app: FastifyInstance, options: Options) {
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const topic = await options.repository.getTopicDetail(id)
    if (!topic) return reply.code(404).send({ message: 'Topic bulunamadı' })
    return reply.send(topic)
  })

  app.get('/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string }
    const topic = await options.repository.getTopicDetail(id)
    if (!topic) return reply.code(404).send({ message: 'Topic bulunamadı' })
    return reply.send({ topicId: id, messages: topic.thread.messages })
  })

  app.get('/:id/reports/:revision/html', async (request, reply) => {
    const { id, revision } = request.params as { id: string; revision: string }
    const parsed = versionSchema.safeParse(revision)
    if (!parsed.success) return reply.code(400).send({ message: 'Geçerli rapor revizyonu gereklidir' })
    const objectKey = await options.repository.getTopicReportHtmlKey(id, parsed.data)
    if (!objectKey) return reply.code(404).send({ message: 'Rapor bulunamadı' })
    if (!options.objectStore) return reply.code(503).send({ message: 'Rapor deposu kullanılamıyor' })
    const html = await options.objectStore.getContent(objectKey)
    return reply.type('text/html; charset=utf-8').send(html)
  })

  app.post('/:id/messages', async (request, reply) => {
    const key = idempotencyKeySchema.safeParse(request.headers['idempotency-key'])
    const body = messageSchema.safeParse(request.body)
    if (!key.success || !body.success) return reply.code(400).send({ message: 'Geçerli Idempotency-Key ve boş olmayan mesaj gereklidir' })
    const { id } = request.params as { id: string }
    try {
      return reply.code(202).send(await options.repository.appendRevisionRequest({
        topicId: id, requestKey: key.data, message: body.data.message, revisionKind: classifyRevisionKind(body.data.message),
      }))
    } catch (error) {
      if (error instanceof TopicNotFoundError) return reply.code(404).send({ message: error.message })
      if (error instanceof TopicCommandConflictError) return reply.code(409).send({ message: error.message })
      throw error
    }
  })

  app.post('/:id/retry', async (request, reply) => {
    const key = idempotencyKeySchema.safeParse(request.headers['idempotency-key'])
    if (!key.success) return reply.code(400).send({ message: 'Geçerli Idempotency-Key gereklidir' })
    const { id } = request.params as { id: string }
    try {
      return reply.code(202).send(await options.repository.requestTopicRetry(id, key.data))
    } catch (error) {
      if (error instanceof TopicNotFoundError) return reply.code(404).send({ message: error.message })
      if (error instanceof TopicRetryConflictError || error instanceof TopicCommandConflictError) return reply.code(409).send({ message: error.message })
      throw error
    }
  })
}
