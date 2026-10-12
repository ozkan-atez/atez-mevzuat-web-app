import {privateResourceWhere,jobInitiatorFields} from '../../platform/actor-context'
import { enforceLocalWorkspace, isLocalWorkspaceRequest } from '../../platform/local-workspace-access'
import { OperationError, type OperationService } from '../operations/operation-service'
import { analyzeArchivedSourceRun } from '../operations/source-run-adapter'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import type { CapturedSourceFile } from './source-attachments'
import { createSourceRun } from './source-scan-run'
import type { TariffCredentials } from './tariff-auth'

const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
})
const createInput = z.object({ sourceId: z.string().uuid(), targetDate: dateInput })
const idInput = z.object({ id: z.string().uuid() })

export async function sourceScanRunRoutes(app: FastifyInstance, options: { prisma: PrismaClient; operations?: OperationService; tariffCredentials?: TariffCredentials | null; objectStore?: {getContent(key:string):Promise<Buffer>} }) {
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

  app.get('/', async () => {
    const runs = await prisma.sourceScanRun.findMany({
      select: { id: true, scanRunId: true, targetDate: true, status: true, trigger: true, createdAt: true, source: { select: { id: true, name: true, key: true } }, _count: { select: { documents: true } }, documents: { select: decisionFields } },
      orderBy: { createdAt: 'desc' }, take: 50,
    })
    return { runs: runs.map(({ documents, ...run }) => ({ ...run, counters: sourceCounters(documents), canAnalyze: options.operations ? !['QUEUED','RUNNING'].includes(run.status) && documents.length > 0 : run.status === 'COMPLETED' && documents.some(document => document.processingStatus === 'PENDING') })) }
  })

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
      ...(options.operations && isLocalWorkspaceRequest(request) ? {operations:{where:privateResourceWhere(),select:{id:true,status:true,operation:true,createdAt:true,tasks:{select:{id:true,status:true,operation:true,errorCategory:true,errorMessage:true}}}}}:{}),
      scanRunId: true, processingScanRunId: true, stages: true, coverage: true, datePolicy: true,
      source: { select: { name: true, key: true, authorityType: true } },
      documents: { orderBy: { title: 'asc' }, select: { id: true, title: true, url: true, publishedOn: true, feedUrl: true, contentText: true, captureStatus: true, captureError: true, capturedFiles: true, ...decisionFields } },
    } })
    if (!run) return reply.code(404).send({ message: 'Tarama bulunamadı.' })
    const counters = sourceCounters(run.documents)
    return { ...run, counters, hasReport: counters.readyReports > 0, canAnalyze: options.operations ? !['QUEUED','RUNNING'].includes(run.status) && run.documents.some(document => document.contentText?.trim() || document.captureStatus === 'COMPLETED') : run.status === 'COMPLETED' && run.documents.some(document => document.processingStatus === 'PENDING') }
  })

  app.get('/:id/documents/:documentId/files/:index', async (request, reply) => {
    const input = z.object({id:z.string().uuid(),documentId:z.string().uuid(),index:z.coerce.number().int().min(0).max(40)}).safeParse(request.params)
    if(!input.success) return reply.code(400).send({message:'Geçersiz dosya bağlantısı.'})
    const document=await prisma.sourceScanDocument.findFirst({where:{id:input.data.documentId,runId:input.data.id},select:{capturedFiles:true}})
    const file = (Array.isArray(document?.capturedFiles) ? document.capturedFiles : []) as unknown as CapturedSourceFile[]
    const selected = file[input.data.index]
    if(!selected || selected.status!=='STORED' || !selected.objectKey) return reply.code(404).send({message:'Arşivlenmiş dosya bulunamadı.'})
    if(!options.objectStore) return reply.code(503).send({message:'Dosya deposu kullanılamıyor.'})
    const bytes=await options.objectStore.getContent(selected.objectKey)
    let name=new URL(selected.url).pathname.split('/').at(-1) || 'kaynak-dosyasi'
    try { name=decodeURIComponent(name) } catch { /* Keep a safe encoded filename. */ }
    return reply.type(selected.mediaType??'application/octet-stream').header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g,'%27')}`).header('Content-Security-Policy',"default-src 'none'").send(bytes)
  })

  app.get('/:id/report', async (request, reply) => {
    const parsed = idInput.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ message: 'Geçersiz tarama kimliği.' })
    const documents = await prisma.sourceScanDocument.findMany({ where: { runId: parsed.data.id, filterDecision: 'IN', processingStatus: 'COMPLETED', topicId: { not: null }, reportVersion: { not: null } }, select: { topicId: true, reportVersion: true } })
    if (!documents.length) return reply.code(404).send({ message: 'AI tarafından doğrulanmış rapor bulunamadı.' })
    if (documents.length > 1) return reply.code(409).send({ message: 'Bu taramada birden fazla rapor var. Belge listesinden raporu seçin.' })
    return reply.redirect(`/api/v1/topics/${documents[0]!.topicId}/reports/${documents[0]!.reportVersion}/html`)
  })

  const enqueueParent = async (id:string) => prisma.$transaction(async tx => {
    const child=await tx.sourceScanRun.findUnique({where:{id},select:{scanRunId:true,status:true}})
    if(!child?.scanRunId)return null
    const parent=await tx.scanRun.updateMany({where:{id:child.scanRunId,status:{in:['FAILED','PARTIAL','COMPLETED','AWAITING_RETRY']}},data:{status:'QUEUED',completedAt:null,errorSummary:null}})
    if(!parent.count)return false
    await tx.sourceScanRun.update({where:{id},data:{...jobInitiatorFields(),status:'QUEUED',completedAt:null,errorSummary:null,queueDispatchedAt:null,queueVersion:{increment:1}}})
    await tx.scanOutbox.create({data:{...jobInitiatorFields(),scanRunId:child.scanRunId,commandType:'START_SCAN',requestKey:`source-retry:${id}:${randomUUID()}`}})
    return true
  })
  app.post('/:id/analyze', async (request, reply) => {
    const parsed = idInput.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ message: 'Geçersiz tarama kimliği.' })
    if(options.operations) {
      if(!enforceLocalWorkspace(request,reply))return reply
      const body=z.object({mode:z.enum(['FILL_MISSING','FORCE']).default('FILL_MISSING')}).strict().safeParse(request.body ?? {})
      if(!body.success)return reply.code(400).send({message:'Analiz seçeneği geçersiz.'})
      try{return reply.code(202).send(await analyzeArchivedSourceRun(prisma,options.operations,parsed.data.id,String(request.headers['idempotency-key'] ?? ''),body.data.mode))}
      catch(error){if(error instanceof OperationError)return reply.code(error.statusCode).send({message:error.message,category:error.category});throw error}
    }
    const parentQueued=await enqueueParent(parsed.data.id)
    if(parentQueued!==null)return reply.code(parentQueued?202:409).send(parentQueued?{runId:parsed.data.id,status:'QUEUED'}:{message:'Ana tarama zaten çalışıyor.'})
    const updated = await prisma.sourceScanRun.updateMany({ where: {
      id: parsed.data.id, OR: [{ status: { in: ['FAILED', 'PARTIAL'] } }, { status: 'COMPLETED', documents: { some: { processingStatus: 'PENDING' } } }],
    }, data: { ...jobInitiatorFields(),status: 'QUEUED', reportHtml: null, completedAt: null, errorSummary: null, queueDispatchedAt: null, queueVersion: { increment: 1 } } })
    if (!updated.count) return reply.code(409).send({ message: 'Bu tarama zaten değerlendirildi veya işlem sürüyor.' })
    return reply.code(202).send({ runId: parsed.data.id, status: 'QUEUED' })
  })

  app.post('/:id/retry', async (request, reply) => {
    const parsed = idInput.safeParse(request.params)
    if (!parsed.success) return reply.code(400).send({ message: 'Geçersiz tarama kimliği.' })
    const current=await prisma.sourceScanRun.findUnique({where:{id:parsed.data.id},select:{status:true}})
    if(!current||!['FAILED','PARTIAL'].includes(current.status))return reply.code(409).send({message:'Yalnızca başarısız veya kısmi tarama yeniden denenebilir.'})
    const parentQueued=await enqueueParent(parsed.data.id)
    if(parentQueued!==null)return reply.code(parentQueued?202:409).send(parentQueued?{runId:parsed.data.id,status:'QUEUED'}:{message:'Ana tarama zaten çalışıyor.'})
    const result = await prisma.sourceScanRun.updateMany({ where: { id: parsed.data.id, status: { in: ['FAILED', 'PARTIAL'] } }, data: { status: 'QUEUED', completedAt: null, errorSummary: null, queueDispatchedAt: null, queueVersion: { increment: 1 } } })
    if (!result.count) return reply.code(409).send({ message: 'Yalnızca başarısız veya kısmi tarama yeniden denenebilir.' })
    return reply.code(202).send({ runId: parsed.data.id, status: 'QUEUED' })
  })
}

const decisionFields = { filterDecision: true, filterReason: true, processingStatus: true, processingError: true, topicId: true, reportVersion: true } as const
function sourceCounters(documents: Array<{ filterDecision: string | null; processingStatus: string; topicId: string | null; reportVersion: number | null }>) {
  return {
    found: documents.length,
    relevant: documents.filter(document => document.filterDecision === 'IN').length,
    excluded: documents.filter(document => document.processingStatus === 'EXCLUDED' || document.filterDecision === 'OUT').length,
    failed: documents.filter(document => document.processingStatus === 'FAILED').length,
    readyReports: documents.filter(document => document.filterDecision === 'IN' && document.processingStatus === 'COMPLETED' && document.topicId && document.reportVersion).length,
  }
}
