import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { authRoutes } from './modules/auth/auth.routes'
import { chatRoutes } from './modules/chat/chat.routes'
import { prisma } from './platform/database'
import { PrismaScanRepository } from './modules/scan-runs/infrastructure/prisma-scan-repository'
import { scanRunsRoutes } from './modules/scan-runs/scan-runs.routes'
import { PrismaTopicAnalysisRepository } from './modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'
import { topicAnalysisRoutes } from './modules/topic-analysis/topic-analysis.routes'
import type { TopicObjectStore } from './modules/topic-analysis/application/ports'

interface BuildAppOptions {
  scanRepository?: PrismaScanRepository
  topicRepository?: PrismaTopicAnalysisRepository
  objectStore?: Pick<TopicObjectStore, 'getContent'>
  healthChecks?: HealthChecks
}

export interface HealthChecks {
  database: () => Promise<void>
  queue: () => Promise<void>
  objectStore: () => Promise<void>
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
  })

  await app.register(cors, {
    origin: true,
    credentials: true,
  })

  app.get('/api/health', async (_request, reply) => {
    const entries = Object.entries(options.healthChecks ?? {
      database: async () => undefined,
      queue: async () => undefined,
      objectStore: async () => undefined,
    }) as Array<[keyof HealthChecks, () => Promise<void>]>
    const results = await Promise.all(entries.map(async ([name, check]) => {
      try {
        await check()
        return [name, 'ready'] as const
      } catch {
        return [name, 'unavailable'] as const
      }
    }))
    const dependencies = Object.fromEntries(results)
    const ready = results.every(([, status]) => status === 'ready')
    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'unavailable',
      dependencies,
      timestamp: new Date().toISOString(),
    })
  })

  // Register Modules
  app.register(authRoutes, { prefix: '/api/auth' })
  app.register(chatRoutes, { prefix: '/api/chat' })
  const topicRepository = options.topicRepository ?? new PrismaTopicAnalysisRepository(prisma)
  app.register(scanRunsRoutes, {
    prefix: '/api/v1/scan-runs',
    repository: options.scanRepository ?? new PrismaScanRepository(prisma),
    topicRepository,
    ...(options.objectStore ? { objectStore: options.objectStore } : {}),
  })
  app.register(topicAnalysisRoutes, { prefix: '/api/v1/topics', repository: topicRepository, ...(options.objectStore ? { objectStore: options.objectStore } : {}) })

  return app
}
