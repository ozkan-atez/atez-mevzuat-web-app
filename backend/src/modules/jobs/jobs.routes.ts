import { FastifyInstance } from 'fastify'
import { getQueue } from '../../platform/queue'
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const prisma = new PrismaClient()

export async function jobsRoutes(app: FastifyInstance) {
  app.post('/test', async (request, reply) => {
    const queue = getQueue()
    
    // 1. Veritabanında iş kaydını oluştur
    const dbJob = await prisma.job.create({
      data: {
        kind: 'TEST_JOB',
        entityId: 'test-entity-123',
        idempotencyKey: crypto.randomUUID(),
      }
    })

    // 2. İş Kuyruğuna (pg-boss) ekle
    const pgBossJobId = await queue.send('test-job', { dbJobId: dbJob.id })

    return reply.code(202).send({ 
      message: 'Job accepted', 
      pgBossJobId, 
      dbJobId: dbJob.id 
    })
  })
}
