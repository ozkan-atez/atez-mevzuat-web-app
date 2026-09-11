import { FastifyInstance } from 'fastify'
import { getQueue } from '../../platform/queue'
import { prisma } from '../../platform/database'

export async function jobsRoutes(app: FastifyInstance) {
  app.post('/test', async (request, reply) => {
    const queue = getQueue()
    const { targetDate } = (request.body as { targetDate?: string }) || {}

    let workflow = await prisma.workflow.findFirst()
    if (!workflow) {
      workflow = await prisma.workflow.create({
        data: {
          key: 'resmi-gazete-gumruk',
          name: 'Resmi Gazete Gümrük & Dış Ticaret Takip Otomasyonu',
        }
      })
    }

    const run = await prisma.workflowRun.create({
      data: {
        workflowId: workflow.id,
        status: 'RUNNING',
        parameters: JSON.stringify({ targetDate: targetDate || new Date().toISOString().split('T')[0] }),
      }
    })

    const pgBossJobId = await queue.send('test-job', { dbJobId: run.id })

    return reply.code(202).send({
      message: 'Tarama görevi kuyruğa eklendi',
      jobId: run.id,
      pgBossJobId,
    })
  })
}
