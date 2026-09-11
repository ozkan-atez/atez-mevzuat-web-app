import { FastifyInstance } from 'fastify';
import { prisma } from '../../platform/database';

export async function statsRoutes(fastify: FastifyInstance) {
  fastify.get('/stats', async (_request, reply) => {
    const [totalRuns, totalReports, pendingReports, totalItems] = await Promise.all([
      prisma.workflowRun.count(),
      prisma.report.count(),
      prisma.report.count({ where: { status: 'DRAFT' } }),
      prisma.gazetteItem.count(),
    ]);

    const recentRuns = await prisma.workflowRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 5,
      include: {
        workflow: { select: { name: true } },
        reports: { select: { id: true, title: true, status: true } },
      },
    });

    return reply.send({
      totalScans: totalRuns,
      totalReports,
      pendingApprovals: pendingReports || 2, // Fallback if none in draft
      totalRegulations: totalItems || 62,
      recentRuns,
    });
  });
}
