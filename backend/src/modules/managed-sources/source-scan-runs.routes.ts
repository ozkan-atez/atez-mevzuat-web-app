import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { createSourceRun } from './source-scan-run'
import type { TariffCredentials } from './tariff-auth'

const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
})
const createInput = z.object({ sourceId: z.string().uuid(), targetDate: dateInput })
const idInput = z.object({ id: z.string().uuid() })

export async function sourceScanRunRoutes(app: FastifyInstance, options: { prisma: PrismaClient; tariffCredentials?: TariffCredentials | null }) {
  const { prisma } = options
  app.get('/sources', async () => {
    const sources = await prisma.source.findMany({ where: { isActive: true }, select: {
      id: true, key: true, name: true, authorityType: true,
      endpoints: { where: { status: 'ACTIVE', adapter: { not: null } }, select: { id: true } },
    }, orderBy: { createdAt: 'asc' } })
    return { sources: sources.map(({ endpoints, ...source }) => ({ ...source,
      available: source.key === 'resmi-gazete' || (endpoints.length > 0 && (source.key !== 'tariff' || Boolean(options.tariffCredentials))),
      reason: source.key === 'tariff' && !options.tariffCredentials ? 'TARIFF hesabı etkinleştirilmeyi bekliyor.' : endpoints.length === 0 && source.key !== 'resmi-gazete' ? 'Tarih akışı yapılandırılmamış.' : null,
    })) }
  })

  app.get('/', async () => ({ runs: await prisma.sourceScanRun.findMany({
    select: { id: true, targetDate: true, status: true, trigger: true, createdAt: true, source: { select: { id: true, name: true, key: true } }, _count: { select: { documents: true } } },
    orderBy: { createdAt: 'desc' }, take: 50,
  }) }))

  app.post('/', async (request, reply) => {
    const parsed = createInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Geçerli kaynak ve tarih seçin.' })
    const source = await prisma.source.findUnique({ where: { id: parsed.data.sourceId } })
    if (!source || source.key === 'resmi-gazete') return reply.code(400).send({ message: 'Resmî Gazete için mevcut tarama akışını kullanın.' })
    if (source.key === 'tariff' && !options.tariffCredentials) return reply.code(422).send({ message: 'TARIFF hesabı etkinleştirilmeyi bekliyor.' })
    const key = request.headers['idempotency-key']
    if (typeof key !== 'string' || !z.string().uuid().safeParse(key).success) return reply.code(400).send({ message: 'Geçerli Idempotency-Key gerekli.' })
    try {
      const run = await createSourceRun(prisma, { ...parsed.data, requestKey: `manual:${key}`, trigger: 'MANUAL' })
      return reply.code(202).send({ runId: run.id, status: run.status, targetDate: parsed.data.targetDate })
    } catch (error) { return reply.code(422).send({ message: error instanceof Error ? error.message : 'Kaynak taraması başlatılamadı.' }) }
  })

  app.get('/:id', async (request, reply) => {
    const parsed = idInput.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ message: 'Geçersiz tarama kimliği.' })
    const run = await prisma.sourceScanRun.findUnique({ where: { id: parsed.data.id }, select: {
      id: true, targetDate: true, status: true, errorSummary: true, createdAt: true, startedAt: true, completedAt: true,
      reportHtml: true,
      source: { select: { name: true, key: true, authorityType: true } },
      documents: { orderBy: { title: 'asc' }, select: { id: true, title: true, url: true, publishedOn: true, feedUrl: true } },
    } })
    return run ? { ...run, reportHtml: undefined, hasReport: run.documents.length > 0 && Boolean(run.reportHtml) } : reply.code(404).send({ message: 'Tarama bulunamadı.' })
  })

  app.get('/:id/report', async (request, reply) => {
    const parsed = idInput.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ message: 'Geçersiz tarama kimliği.' })
    const run = await prisma.sourceScanRun.findUnique({ where: { id: parsed.data.id }, select: { reportHtml: true, _count: { select: { documents: true } } } })
    if (!run?.reportHtml || run._count.documents === 0) return reply.code(404).send({ message: 'Bu taramada raporlanacak bir mevzuat değişikliği bulunmadı.' })
    const download = (request.query as { download?: string }).download === '1'
    if (download) reply.header('Content-Disposition', `attachment; filename="kaynak-raporu-${parsed.data.id}.html"`)
    return reply.type('text/html; charset=utf-8').header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:").send(run.reportHtml)
  })

  app.post('/:id/retry', async (request, reply) => {
    const parsed = idInput.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ message: 'Geçersiz tarama kimliği.' })
    const result = await prisma.sourceScanRun.updateMany({ where: { id: parsed.data.id, status: { in: ['FAILED', 'PARTIAL'] } }, data: { status: 'QUEUED', completedAt: null, errorSummary: null } })
    if (!result.count) return reply.code(409).send({ message: 'Yalnızca başarısız veya kısmi tarama yeniden denenebilir.' })
    return reply.code(202).send({ runId: parsed.data.id, status: 'QUEUED' })
  })
}
