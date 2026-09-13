import type { FastifyInstance } from 'fastify'
import type { PrismaScanRepository } from './infrastructure/prisma-scan-repository'
import { createScanRunSchema, idempotencyKeySchema } from './scan-runs.schemas'

interface Options {
  repository: PrismaScanRepository
}

const terminalStatuses = new Set(['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'])

export async function scanRunsRoutes(app: FastifyInstance, options: Options) {
  app.post('/', async (request, reply) => {
    const keyResult = idempotencyKeySchema.safeParse(request.headers['idempotency-key'])
    const bodyResult = createScanRunSchema.safeParse(request.body)
    if (!keyResult.success || !bodyResult.success) {
      return reply.code(400).send({ message: 'Geçerli Idempotency-Key ve YYYY-MM-DD tarihi gereklidir' })
    }
    const run = await options.repository.createManualRun({ requestKey: keyResult.data, targetDate: bodyResult.data.targetDate })
    return reply.code(202).send({ runId: run.id, status: run.status, targetDate: run.targetDate })
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
