import { Prisma, type PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { reportAccessWhere } from '../../platform/actor-context'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  query: z.string().trim().max(300).default(''),
  origin: z.enum(['ALL', 'AUTOMATION', 'MANUAL', 'UNKNOWN']).default('ALL'),
  content: z.enum(['ALL', 'LEGISLATION', 'DOCUMENT', 'NO_CHANGE']).default('ALL'),
  sort: z.enum(['newest', 'date']).default('newest'),
})

const automatedRun = { OR: [{ automationId: { not: null } }, { trigger: 'CRON' as const }] }
export const automationReportWhere: Prisma.TopicReportWhereInput = { OR: [
  { scanRun: { is: automatedRun } },
  { operationTask: { is: { request: { is: { parameters: { path: ['automationId'], not: Prisma.AnyNull } } } } } },
  { operationTask: { is: { request: { is: { sourceRun: { is: { scanRun: { is: automatedRun } } } } } } } },
] }
const knownReportWhere: Prisma.TopicReportWhereInput = { OR: [{ scanRunId: { not: null } }, { operationTaskId: { not: null } }] }

export async function reportsRoutes(app: FastifyInstance, { prisma }: { prisma: PrismaClient }) {
  app.get('/reports', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ message: 'Rapor filtreleri geçersiz.' })
    const input = parsed.data
    const conditions: Prisma.TopicReportWhereInput[] = [reportAccessWhere(), { latestVersion: { gt: 0 } }]
    if (input.query) conditions.push({ OR: [{ title: { contains: input.query, mode: 'insensitive' } }, { id: { contains: input.query, mode: 'insensitive' } }] })
    if (input.origin === 'AUTOMATION') conditions.push(automationReportWhere)
    if (input.origin === 'MANUAL') conditions.push(knownReportWhere, { NOT: automationReportWhere })
    if (input.origin === 'UNKNOWN') conditions.push({ NOT: knownReportWhere })
    if (input.content === 'DOCUMENT') conditions.push({ operationTaskId: { not: null } })
    if (input.content === 'NO_CHANGE') conditions.push({ card: 'K6', operationTaskId: null })
    if (input.content === 'LEGISLATION') conditions.push({ card: { not: 'K6' }, operationTaskId: null })
    const where: Prisma.TopicReportWhereInput = { AND: conditions }
    const [total, rows] = await prisma.$transaction([
      prisma.topicReport.count({ where }),
      prisma.topicReport.findMany({ where, skip: (input.page - 1) * input.pageSize, take: input.pageSize,
        orderBy: input.sort === 'date' ? [{ scanRun: { targetDate: 'desc' } }, { updatedAt: 'desc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'asc' }],
        include: {
          ownerUser: { select: { id: true, name: true } },
          scanRun: { select: { targetDate: true, trigger: true, automationId: true, workspaceConfig: true, sourceKeys: true, initiator: { select: { id: true, name: true } } } },
          operationTask: { select: { request: { select: { parameters: true, ownerUser: { select: { id: true, name: true } }, sourceRun: { select: { scanRun: { select: { automationId: true, trigger: true } } } } } } } },
          revisions: { where: { status: 'VALIDATED' }, orderBy: { version: 'desc' }, take: 1, select: { createdAt: true } },
        },
      }),
    ])
    const automationIds = [...new Set(rows.flatMap(row => {
      const parameters = row.operationTask?.request.parameters as Record<string, unknown> | undefined
      const id = row.scanRun?.automationId ?? (typeof parameters?.automationId === 'string' ? parameters.automationId : null) ?? row.operationTask?.request.sourceRun?.scanRun?.automationId
      return id ? [id] : []
    }))]
    const automations = automationIds.length ? await prisma.workspaceAutomation.findMany({ where: { id: { in: automationIds } }, select: { id: true, name: true } }) : []
    return { total, page: input.page, pageSize: input.pageSize, reports: rows.map(row => {
      const parameters = row.operationTask?.request.parameters as Record<string, unknown> | undefined
      const config = row.scanRun?.workspaceConfig as Record<string, unknown> | undefined
      const automationId = row.scanRun?.automationId ?? (typeof parameters?.automationId === 'string' ? parameters.automationId : null) ?? row.operationTask?.request.sourceRun?.scanRun?.automationId ?? null
      const automated = Boolean(automationId || row.scanRun?.trigger === 'CRON' || row.operationTask?.request.sourceRun?.scanRun?.trigger === 'CRON')
      return {
        id: row.id, title: row.title, runId: row.scanRunId, topicId: row.topicId, version: row.latestVersion,
        targetDate: row.scanRun?.targetDate.toISOString().slice(0, 10) ?? null,
        publishedAt: (row.revisions[0]?.createdAt ?? row.createdAt).toISOString(),
        origin: automated ? 'AUTOMATION' : row.scanRunId || row.operationTaskId ? 'MANUAL' : 'UNKNOWN',
        automationId, automationName: automations.find(item => item.id === automationId)?.name ?? (typeof config?.name === 'string' ? config.name : null),
        initiatedBy: row.scanRun?.initiator ?? row.operationTask?.request.ownerUser ?? row.ownerUser,
        sources: row.scanRun?.sourceKeys ?? [],
        contentType: row.operationTaskId ? 'DOCUMENT' : row.card === 'K6' ? 'NO_CHANGE' : 'LEGISLATION',
        standalone: Boolean(row.operationTaskId),
      }
    }) }
  })
}
