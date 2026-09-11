import { FastifyInstance } from 'fastify';
import { prisma } from '../../platform/database';

export async function runsRoutes(fastify: FastifyInstance) {
  // Belirli bir tarama görevini tüm detaylarıyla (loglar, maddeler, raporlar) getir
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const run = await prisma.workflowRun.findUnique({
      where: { id },
      include: {
        workflow: { select: { name: true } },
        logs: { orderBy: { createdAt: 'asc' } },
        items: { orderBy: { relevanceScore: 'desc' } },
        reports: true,
        dispatches: true,
      },
    });

    if (!run) {
      return reply.status(404).send({ error: 'Tarama görevi bulunamadı' });
    }

    return reply.send(run);
  });

  // Tüm tarama geçmişini listele
  fastify.get('/', async (_request, reply) => {
    const runs = await prisma.workflowRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
      include: {
        workflow: { select: { name: true } },
        _count: {
          select: { items: true, reports: true },
        },
      },
    });

    return reply.send(runs);
  });
}
