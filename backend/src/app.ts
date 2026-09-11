import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { authRoutes } from './modules/auth/auth.routes'
import { jobsRoutes } from './modules/jobs/jobs.routes'
import { chatRoutes } from './modules/chat/chat.routes'
import { runsRoutes } from './modules/runs/runs.routes'
import { reportsRoutes } from './modules/reports/reports.routes'
import { mailRoutes } from './modules/mail/mail.routes'
import { statsRoutes } from './modules/stats/stats.routes'
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
  app.get('/api/health', async (_request, _reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  // Register Vertical Slice Modules
  app.register(authRoutes, { prefix: '/api/auth' })
  app.register(jobsRoutes, { prefix: '/api/jobs' })
  app.register(chatRoutes, { prefix: '/api/chat' })
  app.register(runsRoutes, { prefix: '/api/runs' })
  app.register(reportsRoutes, { prefix: '/api/reports' })
  app.register(mailRoutes, { prefix: '/api' })
  app.register(statsRoutes, { prefix: '/api' })

  return app
}
