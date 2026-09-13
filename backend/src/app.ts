import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { authRoutes } from './modules/auth/auth.routes'
import { chatRoutes } from './modules/chat/chat.routes'
import { prisma } from './platform/database'
import { PrismaScanRepository } from './modules/scan-runs/infrastructure/prisma-scan-repository'
import { scanRunsRoutes } from './modules/scan-runs/scan-runs.routes'

interface BuildAppOptions {
  scanRepository?: PrismaScanRepository
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
  })

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
  app.register(chatRoutes, { prefix: '/api/chat' })
  app.register(scanRunsRoutes, {
    prefix: '/api/v1/scan-runs',
    repository: options.scanRepository ?? new PrismaScanRepository(prisma),
  })

  return app
}
