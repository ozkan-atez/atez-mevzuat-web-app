import { TemplateDefinitionSchema, defaultTemplateDefinition } from './template-definition'
import { usageQuerySchema, getConversationUsage, getUsageDetails } from '../usage/usage-query'
import { isLocalWorkspaceRequest } from '../../platform/local-workspace-access'
import { getActorContext, privateResourceWhere } from '../../platform/actor-context'
import type { FastifyInstance } from 'fastify'
import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { DateTime } from 'luxon'
import { ensureWorkspaceCatalog, scanSupported, sectionComponents } from './catalog'
import { templateHtml, defaultSections, normalizeTemplateSections, TemplateContentError } from './report-template-catalog'
import { runAutomation, validateAutomation } from './automations'
import { rabbitQueue } from '../../platform/rabbitmq'
import { getDayActivity } from './day-activity'

const sourceSchema = z.object({ key: z.string().trim().min(1).max(120), name: z.string().trim().min(1).max(200), description: z.string().max(2000).nullable().optional(), baseUrl: z.url().refine(s => ['https:', 'http:'].includes(new URL(s).protocol)), authorityType: z.enum(['OFFICIAL', 'REFERENCE', 'COMMERCIAL', 'PROFESSIONAL', 'UNVERIFIED']).default('REFERENCE'), isActive: z.boolean().default(true) })
const sectionSchema = z.object({ id: z.string().min(1).max(80), heading: z.string().max(300), html: z.string().max(100000), enabled: z.boolean() })
const templateSchema = z.object({ definition: TemplateDefinitionSchema.nullable().optional(), expectedRevision: z.number().int().positive().optional(), name: z.string().trim().min(1).max(200), description: z.string().max(2000).nullable().optional(), html: z.string().min(1).max(500000), sections: z.array(sectionSchema).min(1).max(30).refine(rows => new Set(rows.map(r => r.id)).size === rows.length, 'Bölüm kimlikleri benzersiz olmalıdır.'), isActive: z.boolean().default(true) })
export const automationSchema = z.object({ name: z.string().trim().min(1).max(200), datePolicy: z.enum(['PUBLISHED_DATE','NEW_OR_CHANGED']).default('PUBLISHED_DATE'), times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).max(24).refine(times => new Set(times).size === times.length, 'Tekrar saatleri benzersiz olmalıdır.').default([]), weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).refine(days => new Set(days).size === days.length, 'Günler benzersiz olmalıdır.').default([1,2,3,4,5,6,7]), hour: z.number().int().min(0).max(23).default(8), minute: z.number().int().min(0).max(59).default(0), timezone: z.string().refine(tz => DateTime.now().setZone(tz).isValid).default('Europe/Istanbul'), sourceIds: z.array(z.string().min(1)).min(1), groupIds: z.array(z.string().min(1)).default([]), templateId: z.string().nullable().default(null), isActive: z.boolean().default(true) })
const userSchema = z.object({ email: z.email(), name: z.string().max(200).nullable().optional(), role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']).default('VIEWER'), isActive: z.boolean().default(true) })
function clean(value: object, input?: object) { return Object.fromEntries(Object.entries(value).filter(([key, v]) => v !== undefined && (!input || Object.hasOwn(input, key)))) }
const automationRunSelect = {
  id: true, automationId: true, workspaceConfig: true, scheduleSlot: true, trigger: true,
  status: true, targetDate: true, createdAt: true, startedAt: true, completedAt: true,
  errorSummary: true, totalItems: true, completedItems: true, failedItems: true,
  topicReports: { select: { id: true, title: true, topicId: true, latestVersion: true } },
  sourceRuns: { select: { id: true, status: true, errorSummary: true, source: { select: { id: true, name: true, key: true } }, _count: { select: { documents: true } } } },
} satisfies Prisma.ScanRunSelect

export async function workspaceRoutes(app: FastifyInstance, { prisma, modularOperationsEnabled = false }: { prisma: PrismaClient; modularOperationsEnabled?: boolean }) {
  app.get('/api/v1/workspace/activity', async (request, reply) => {
    const query = z.object({ days: z.enum(['1', '7']).default('1'), kind: z.enum(['REPORT', 'REVISION', 'CHAT', 'SCAN']).optional() }).safeParse(request.query)
    if (!query.success) return reply.code(400).send({ message: 'Geçerli bir dönem ve hareket türü seçin.' })
    return getDayActivity(prisma, query.data.days === '7' ? 7 : 1, query.data.kind)
  })
  // Catalog initialization is lazy so API health and unrelated modules stay available if migrations are missing.
  let initialized = false
  const initialize = async () => { if (!initialized) { await ensureWorkspaceCatalog(prisma); initialized = true } }
  const guarded = (handler: (request: any, reply: any) => Promise<unknown>) => async (request: any, reply: any) => {
    try { return await handler(request, reply) } catch (error) {
      if (error instanceof TemplateContentError) return reply.code(400).send({ message: error.message })
      if (error instanceof z.ZodError) return reply.code(400).send({ message: 'Geçerli alanlar gereklidir.', issues: error.issues })
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') return reply.code(404).send({ message: 'Kayıt bulunamadı.' })
        if (error.code === 'P2002') return reply.code(409).send({ message: 'Aynı isim veya anahtarla bir kayıt mevcut.' })
      }
      throw error
    }
  }
  app.get('/api/v1/sources', guarded(async () => { await ensureWorkspaceCatalog(prisma); return { sources: (await prisma.source.findMany({ orderBy: { createdAt: 'asc' }, include: { endpoints: true, profiles: { select: { status: true } }, credentials: { select: { id: true } } } })).map(s => ({ ...s, credentials: undefined, name: s.name || s.key, scanSupported: scanSupported(s) })) } }))
  app.post('/api/v1/sources', guarded(async (r, reply) => reply.code(201).send(await prisma.source.create({ data: clean(sourceSchema.parse(r.body)) as Prisma.SourceCreateInput }))))
  app.patch('/api/v1/sources/:id', guarded(async r => prisma.source.update({ where: { id: r.params.id }, data: clean(sourceSchema.partial().parse(r.body), r.body) as Prisma.SourceUpdateInput })))
  app.delete('/api/v1/sources/:id', guarded(async (r, reply) => { await prisma.source.update({ where: { id: r.params.id }, data: { isActive: false } }); return reply.code(204).send() }))
  app.get('/api/v1/templates', guarded(async () => { await initialize(); return { templates: await prisma.reportTemplate.findMany({ orderBy: { createdAt: 'asc' } }), components: sectionComponents, defaultHtml: templateHtml, defaultSections, defaultDefinition: defaultTemplateDefinition() } }))
  app.post('/api/v1/templates', guarded(async (r, reply) => {
    const {expectedRevision,definition,...data}=templateSchema.parse(r.body)
    return reply.code(201).send(await prisma.reportTemplate.create({data:{...clean(data),name:data.name,isActive:data.isActive,html:templateHtml,sections:definition ? data.sections : normalizeTemplateSections(data.sections),...(definition?{definition:definition as Prisma.InputJsonValue}:{})}}))
  }))
  app.patch('/api/v1/templates/:id', guarded(async (r,reply) => {
    const input=templateSchema.partial().parse(r.body)
    const original=await prisma.reportTemplate.findUniqueOrThrow({where:{id:r.params.id}})
    if(input.expectedRevision===undefined)return reply.code(409).send({message:'Güncel şablonu yeniden açıp kaydedin.'})
    const {expectedRevision,definition,...fields}=input
    if(original.definition && definition===null)return reply.code(400).send({message:'Yeni şablon içeriği kaldırılamaz.'})
    const data=clean(fields,r.body)
    const sections=input.sections ? (definition || original.definition ? input.sections : normalizeTemplateSections(input.sections,original.sections as unknown as typeof defaultSections)) : undefined
    const saved=await prisma.reportTemplate.updateMany({where:{id:r.params.id,revision:expectedRevision},data:{...data,html:templateHtml,...(sections?{sections}:{}),...(definition?{definition:definition as Prisma.InputJsonValue}:{}),revision:{increment:1}} as Prisma.ReportTemplateUpdateManyMutationInput})
    if(!saved.count)return reply.code(409).send({message:'Şablon başka bir yerde değişti. Çalışmanızı koruyup güncel sürümü yeniden açın.'})
    return prisma.reportTemplate.findUniqueOrThrow({where:{id:r.params.id}})
  }))
  app.delete('/api/v1/templates/:id', guarded(async (r, reply) => { await prisma.reportTemplate.update({ where: { id: r.params.id }, data: { isActive: false } }); return reply.code(204).send() }))
  app.get('/api/v1/background-jobs', async (request, reply) => {
    const parsed=z.object({page:z.coerce.number().int().min(1).default(1),status:z.enum(['RUNNING','RETRY','FAILED','COMPLETED']).optional(),queue:z.string().max(150).optional()}).safeParse(request.query)
    if(!parsed.success)return reply.code(400).send({message:'İşlem geçmişi filtreleri geçersiz.'})
    try {
      const where={...(parsed.data.status?{status:parsed.data.status}:{}),...(parsed.data.queue?{queue:parsed.data.queue}:{})}
      const [queues, jobs,total,counts,types] = await Promise.all([
        rabbitQueue.status().catch(()=>null),
        prisma.backgroundJob.findMany({where,orderBy:[{updatedAt:'desc'},{id:'asc'}],skip:(parsed.data.page-1)*15,take:15}),
        prisma.backgroundJob.count({where}),
        prisma.backgroundJob.groupBy({by:['status'],_count:{_all:true}}),
        prisma.backgroundJob.findMany({distinct:['queue'],select:{queue:true},orderBy:{queue:'asc'}}),
      ])
      return {connected:queues!==null,queues:queues ?? [],jobs,total,page:parsed.data.page,types:types.map(item=>item.queue),counts:Object.fromEntries(counts.map(item=>[item.status,item._count._all])),checkedAt:new Date().toISOString()}
    } catch { return reply.code(503).send({ message: 'İşlem geçmişi şu anda alınamıyor. Biraz sonra yeniden deneyin.' }) }
  })
  app.get('/api/v1/automations', guarded(async () => ({ automations: await prisma.workspaceAutomation.findMany({ orderBy: { createdAt: 'asc' } }) })))
  app.get('/api/v1/automations/:id', guarded(async r => {
    const query = z.object({ page: z.coerce.number().int().min(1).default(1), status: z.enum(['QUEUED', 'RUNNING', 'AWAITING_RETRY', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED']).optional() }).parse(r.query)
    const automation = await prisma.workspaceAutomation.findUniqueOrThrow({ where: { id: r.params.id } })
    const where: Prisma.ScanRunWhereInput = { automationId: r.params.id, ...(query.status ? { status: query.status } : {}) }
    const [runs, total] = await Promise.all([
      prisma.scanRun.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * 10, take: 10, select: automationRunSelect }),
      prisma.scanRun.count({ where }),
    ])
    return { automation, runs, total, ...(modularOperationsEnabled && isLocalWorkspaceRequest(r) ? { operations: await prisma.operationRequest.findMany({ where: { ...privateResourceWhere(), parameters: { path: ['automationId'], equals: r.params.id } }, orderBy: { createdAt: 'desc' }, take: 30, include: { tasks: { include: { artifacts: true }, orderBy: { createdAt: 'asc' } } } }) } : {}) }
  }))
  app.post('/api/v1/automations', guarded(async (r, reply) => { const data = automationSchema.parse(r.body); try { if (data.isActive) await validateAutomation(prisma, data) } catch (e) { return reply.code(400).send({ message: (e as Error).message }) }; return reply.code(201).send(await prisma.workspaceAutomation.create({ data })) }))
  app.patch('/api/v1/automations/:id', guarded(async (r, reply) => { const original = await prisma.workspaceAutomation.findUniqueOrThrow({ where: { id: r.params.id } }); const data = automationSchema.parse({ ...original, ...clean(automationSchema.partial().parse(r.body), r.body) }); try { if (data.isActive) await validateAutomation(prisma, data) } catch (e) { return reply.code(400).send({ message: (e as Error).message }) }; return prisma.workspaceAutomation.update({ where: { id: r.params.id }, data: { ...data, lastError: null, scheduleVersion: { increment: 1 } } }) }))
  app.delete('/api/v1/automations/:id', guarded(async (r, reply) => { await prisma.workspaceAutomation.delete({ where: { id: r.params.id } }); return reply.code(204).send() }))
  app.post('/api/v1/automations/:id/run', guarded(async (r, reply) => { const { requestKey } = z.object({ requestKey: z.string().min(8).max(200) }).parse(r.body); try { return await runAutomation(prisma, r.params.id, requestKey) } catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError) throw e; return reply.code(400).send({ message: (e as Error).message }) } }))
  app.get('/api/v1/users', guarded(async () => {
    const actor = getActorContext()
    const users = await prisma.user.findMany({ ...(actor ? { where: { memberships: { some: { workspaceId: actor.workspaceId } } }, include: { memberships: { where: { workspaceId: actor.workspaceId }, select: { role: true, active: true } } } } : {}), orderBy: { createdAt: 'asc' } })
    return { users: users.map(user => {
      const membership = 'memberships' in user ? (user.memberships as Array<{role:string;active:boolean}>)[0] : undefined
      return { ...user, ...(membership ? { role: membership.role, isActive: user.isActive && membership.active } : {}), memberships: undefined }
    }) }
  }))
  app.post('/api/v1/users', guarded(async (r, reply) => {
    const data = userSchema.parse(r.body), actor = getActorContext()
    const user = await prisma.$transaction(async tx => {
      const created = await tx.user.create({ data: clean(data) as Prisma.UserCreateInput })
      if (actor) await tx.workspaceMembership.create({ data: { userId: created.id, workspaceId: actor.workspaceId, role: data.role, active: data.isActive } })
      return created
    })
    // Identity linking is a separate explicit issuer+subject provisioning action.
    return reply.code(201).send(user)
  }))
  app.patch('/api/v1/users/:id', guarded(async r => {
    const data = clean(userSchema.partial().parse(r.body), r.body), actor = getActorContext()
    if (!actor) return prisma.user.update({ where: { id: r.params.id }, data: data as Prisma.UserUpdateInput })
    return prisma.$transaction(async tx => {
      const membership = await tx.workspaceMembership.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: actor.workspaceId, userId: r.params.id } } })
      const user = await tx.user.update({ where: { id: r.params.id }, data: data as Prisma.UserUpdateInput })
      await tx.workspaceMembership.update({ where: { id: membership.id }, data: { ...(typeof data.role === 'string' ? { role: data.role, permissions: [] } : {}), ...(typeof data.isActive === 'boolean' ? { active: data.isActive } : {}) } })
      if (data.role !== undefined || data.isActive === false) await tx.authSession.updateMany({ where: { userId: r.params.id, workspaceId: actor.workspaceId, revoked: false }, data: { revoked: true, revokedAt: new Date(), reason: 'MEMBERSHIP_CHANGED', encryptedTokens: null, version: { increment: 1 } } })
      return user
    })
  }))
  app.get('/api/v1/usage', async (request, reply) => {
    const query = usageQuerySchema.safeParse(request.query)
    if (!query.success) return reply.code(400).send({message: 'Geçerli bir tarih aralığı ve filtre seçin.'})
    return getConversationUsage(prisma, query.data)
  })
  app.get('/api/v1/usage/details', async (request, reply) => {
    const query = usageQuerySchema.safeParse(request.query)
    if (!query.success || !query.data.conversationId || !query.data.type) return reply.code(400).send({message: 'Sohbet ve türünü seçin.'})
    return getUsageDetails(prisma, query.data)
  })
}
