import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { authRoutes } from './modules/auth/auth.routes'
import { jobsRoutes } from './modules/jobs/jobs.routes'
import { chatRoutes } from './modules/chat/chat.routes'
import { startQueue } from './platform/queue'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
  })

  await startQueue() // pg-boss'u uygulamaya bağlamadan önce başlat

  await app.register(cors, {
    origin: true,
    credentials: true,
  })

  // Global Health Check
  app.get('/api/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  // Register Modules
  app.register(authRoutes, { prefix: '/api/auth' })
  app.register(jobsRoutes, { prefix: '/api/jobs' })
  app.register(chatRoutes, { prefix: '/api/chat' })

  return app
}
