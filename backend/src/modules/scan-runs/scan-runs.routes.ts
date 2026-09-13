import type { FastifyInstance } from 'fastify'
import { AiFilterRetryConflictError, type PrismaScanRepository } from './infrastructure/prisma-scan-repository'
import { createScanRunSchema, idempotencyKeySchema } from './scan-runs.schemas'

interface Options {
  repository: PrismaScanRepository
}

const terminalStatuses = new Set(['AWAITING_RETRY', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'])

export async function scanRunsRoutes(app: FastifyInstance, options: Options) {
  app.get('/', async (request) => {
    const query = request.query as { limit?: string }
    const parsedLimit = Number(query.limit ?? 10)
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 50) : 10
    return { runs: await options.repository.listRuns(limit) }
  })

  app.post('/', async (request, reply) => {
    const keyResult = idempotencyKeySchema.safeParse(request.headers['idempotency-key'])
    const bodyResult = createScanRunSchema.safeParse(request.body)
    if (!keyResult.success || !bodyResult.success) {
      return reply.code(400).send({ message: 'Geçerli Idempotency-Key ve YYYY-MM-DD tarihi gereklidir' })
    }
    const run = await options.repository.createManualRun({ requestKey: keyResult.data, targetDate: bodyResult.data.targetDate })
    return reply.code(202).send({ runId: run.id, status: run.status, targetDate: run.targetDate })
  })

  app.post('/:id/ai-filter/retry', async (request, reply) => {
    const keyResult = idempotencyKeySchema.safeParse(request.headers['idempotency-key'])
    if (!keyResult.success) return reply.code(400).send({ message: 'Geçerli Idempotency-Key gereklidir' })
    const { id } = request.params as { id: string }
    try {
      return reply.code(202).send(await options.repository.requestAiFilterRetry(id, keyResult.data))
    } catch (error) {
      if (error instanceof AiFilterRetryConflictError) return reply.code(409).send({ message: 'AI filtresi yeniden denenmeye hazır değil' })
      throw error
    }
  })

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const run = await options.repository.getRun(id)
    if (!run) return reply.code(404).send({ message: 'Tarama bulunamadı' })
    return reply.send(run)
  })

  app.get('/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string }
    const initial = await options.repository.getRun(id)
    if (!initial) return reply.code(404).send({ message: 'Tarama bulunamadı' })

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    })
    let lastPayload = ''
    const send = async () => {
      const run = await options.repository.getRun(id)
      if (!run) return
      const payload = JSON.stringify(run)
      if (payload !== lastPayload) {
        reply.raw.write(`event: scan.snapshot\ndata: ${payload}\n\n`)
        lastPayload = payload
      }
      if (terminalStatuses.has(run.status)) close()
    }
    const timer = setInterval(() => void send(), 1_000)
    const close = () => {
      clearInterval(timer)
      if (!reply.raw.writableEnded) reply.raw.end()
    }
    request.raw.once('close', close)
    await send()
  })
}
