import { installLocalWorkspaceBoundary } from '../../platform/local-workspace-access'
import type { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { OperationError, type OperationService } from './operation-service'
export async function operationsRoutes(app: FastifyInstance, { service }: { service: OperationService }) {
 installLocalWorkspaceBoundary(app)
  const handle = async (reply: any, action: () => Promise<unknown>) => {
    try { return await action() } catch(error) {
      if (error instanceof OperationError) return reply.code(error.statusCode).send({ message: error.message, category: error.category })
      if (error instanceof ZodError) return reply.code(400).send({ message: 'İşlem girdileri geçersiz.', issues: error.issues })
      throw error
    }
  }
  app.post('/operations/plan', (request, reply) => handle(reply, () => service.plan(request.body)))
  app.post('/operations', (request, reply) => handle(reply, async () => { const result = await service.start(request.body, String(request.headers['idempotency-key'] ?? '')); reply.code(result.status === 'SUCCEEDED' ? 200 : 202); return result }))
  app.get('/operations/:id', (request, reply) => handle(reply, () => service.get((request.params as { id: string }).id)))
  app.post('/operations/:id/cancel', (request, reply) => handle(reply, () => service.cancel((request.params as { id: string }).id)))
  app.post('/operation-tasks/:id/retry', (request, reply) => handle(reply, () => service.retry((request.params as { id: string }).id)))
}
