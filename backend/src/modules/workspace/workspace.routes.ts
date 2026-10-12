import { sectionSchema, semanticDefaultSections } from './template-sections'
import { templateAccessWhere } from '../managed-sources/source-access'
import { isLocalWorkspaceRequest } from '../../platform/local-workspace-access'
import { getActorContext, privateResourceWhere } from '../../platform/actor-context'
import type { FastifyInstance } from 'fastify'
import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { DateTime } from 'luxon'
import { ensureWorkspaceCatalog, scanSupported, sectionComponents } from './catalog'
import { templateHtml, defaultSections, normalizeTemplateSections, TemplateContentError } from './report-template-catalog'
import { SCAN_SCHEDULE } from '../scan-runs/domain/scan-schedule'
import { runAutomation, validateAutomation } from './automations'
import { rabbitQueue } from '../../platform/rabbitmq'
import { getDayActivity } from './day-activity'

const sourceSchema = z.object({ key: z.string().trim().min(1).max(120), name: z.string().trim().min(1).max(200), description: z.string().max(2000).nullable().optional(), baseUrl: z.url().refine(s => ['https:', 'http:'].includes(new URL(s).protocol)), authorityType: z.enum(['OFFICIAL', 'REFERENCE', 'COMMERCIAL', 'PROFESSIONAL', 'UNVERIFIED']).default('REFERENCE'), isActive: z.boolean().default(true) })
const templateSchema = z.object({ revision: z.number().int().positive().optional(), name: z.string().trim().min(1).max(200), description: z.string().max(2000).nullable().optional(), html: z.string().min(1).max(500000), sections: z.array(sectionSchema).min(1).max(30).refine(rows => new Set(rows.map(r => r.id)).size === rows.length, 'Bölüm kimlikleri benzersiz olmalıdır.'), isActive: z.boolean().default(true) })
export const automationSchema = z.object({ name: z.string().trim().min(1).max(200), datePolicy: z.enum(['PUBLISHED_DATE','NEW_OR_CHANGED']).default('PUBLISHED_DATE'), times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).max(24).refine(times => new Set(times).size === times.length, 'Tekrar saatleri benzersiz olmalıdır.').default([]), weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).refine(days => new Set(days).size === days.length, 'Günler benzersiz olmalıdır.').default([1,2,3,4,5,6,7]), hour: z.number().int().min(0).max(23).default(8), minute: z.number().int().min(0).max(59).default(0), timezone: z.string().refine(tz => DateTime.now().setZone(tz).isValid).default('Europe/Istanbul'), sourceIds: z.array(z.string().min(1)).min(1), groupIds: z.array(z.string().min(1)).default([]), templateId: z.string().nullable().default(null), isActive: z.boolean().default(true) })
const userSchema = z.object({ email: z.email(), name: z.string().max(200).nullable().optional(), role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']).default('VIEWER'), isActive: z.boolean().default(true) })
class TemplateRevisionConflict extends Error {}
function clean(value: object, input?: object) { return Object.fromEntries(Object.entries(value).filter(([key, v]) => v !== undefined && (!input || Object.hasOwn(input, key)))) }
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
      if(error instanceof TemplateRevisionConflict)return reply.code(409).send({message:'Şablon başka bir kullanıcı tarafından değiştirildi. Güncel sürümü açın.'})
      if (error instanceof TemplateContentError) return reply.code(400).send({ message: error.message })
      if (error instanceof z.ZodError) return reply.code(400).send({ message: 'Geçerli alanlar gereklidir.', issues: error.issues })
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') return reply.code(404).send({ message: 'Kayıt bulunamadı.' })
        if (error.code === 'P2002') return reply.code(409).send({ message: 'Aynı isim veya anahtarla bir kayıt mevcut.' })
      }
      throw error
    }
  }
  app.get('/api/v1/templates', guarded(async () => { await initialize(); return { templates: (await prisma.reportTemplate.findMany({ where: templateAccessWhere(), orderBy: { createdAt: 'asc' } })).map(template => ({...template, html: templateHtml})), components: sectionComponents, defaultHtml: templateHtml, defaultSections: semanticDefaultSections } }))
  app.post('/api/v1/templates', guarded(async (r, reply) => reply.code(201).send(await prisma.reportTemplate.create({ data: { ...templateSchema.parse(r.body), workspaceId:getActorContext()?.workspaceId??null, html: templateHtml, sections: normalizeTemplateSections(templateSchema.parse(r.body).sections) } as Prisma.ReportTemplateCreateInput }))))
  app.patch('/api/v1/templates/:id', guarded(async r => {
    const data = clean(templateSchema.partial().parse(r.body), r.body)
    const original = await prisma.reportTemplate.findFirstOrThrow({ where: {id:r.params.id,...templateAccessWhere()} })
    if(r.body.revision !== undefined && r.body.revision !== original.revision) throw new TemplateRevisionConflict()
    const sections = r.body.sections ? normalizeTemplateSections(templateSchema.parse({...r.body,name:r.body.name ?? original.name,html:templateHtml}).sections, original.sections as unknown as typeof defaultSections) : undefined
    const result=await prisma.reportTemplate.updateMany({where:{id:r.params.id,revision:original.revision,...templateAccessWhere()},data:{...data,revision:{increment:1},html:templateHtml,...(sections ? {sections} : {})} as Prisma.ReportTemplateUpdateManyMutationInput})
    if(!result.count)throw new TemplateRevisionConflict()
    return prisma.reportTemplate.findUniqueOrThrow({where:{id:r.params.id}})
  }))
  app.delete('/api/v1/templates/:id', guarded(async (r, reply) => { await prisma.reportTemplate.updateMany({ where: { id: r.params.id,...templateAccessWhere() }, data: { isActive: false,revision:{increment:1} } }); return reply.code(204).send() }))
  app.get('/api/v1/background-jobs', async (_request, reply) => {
    try {
      const [queues, jobs] = await Promise.all([rabbitQueue.status(), prisma.backgroundJob.findMany({ where: { status: { not: 'COMPLETED' } }, orderBy: { updatedAt: 'desc' }, take: 50 })])
      return { broker: 'RabbitMQ', connected: true, queues, jobs }
    } catch { return reply.code(503).send({ message: 'RabbitMQ veya iş takibi veritabanına erişilemiyor.' }) }
  })
  app.get('/api/v1/automations', guarded(async () => ({ automations: await prisma.workspaceAutomation.findMany({ orderBy: { createdAt: 'asc' } }), builtInSchedules: SCAN_SCHEDULE.map(s => ({ ...s, minute: 0, timezone: 'Europe/Istanbul', readOnly: true })) })))
  app.get('/api/v1/automations/:id', guarded(async r => ({ automation: await prisma.workspaceAutomation.findUniqueOrThrow({ where: { id: r.params.id } }), runs: await prisma.scanRun.findMany({ where: { automationId: r.params.id }, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, status: true, targetDate: true, createdAt: true, errorSummary: true, sourceRuns: { select: { id: true, status: true, errorSummary: true, source: { select: { id: true, name: true, key: true } }, _count: { select: { documents: true } } } } } }), ...(modularOperationsEnabled && isLocalWorkspaceRequest(r) ? { operations: await prisma.operationRequest.findMany({ where: { ...privateResourceWhere(), parameters: { path: ['automationId'], equals: r.params.id } }, orderBy: { createdAt: 'desc' }, take: 30, include: { tasks: { include: { artifacts: true }, orderBy: { createdAt: 'asc' } } } }) } : {}) })))
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
  const toAttempt = (row: { id: string; lessonId: string; period: string; score: number }) => {
    const total = row.lessonId === 'weekly' ? 5 : 3
    const correct = Math.round(row.score * total / 100)
    return { id: row.id, type: row.lessonId, date: row.period, correct, total, points: correct * 10 }
  }
  app.get('/api/v1/academy/attempts', guarded(async () => {
    const actor = getActorContext()
    return { attempts: (await prisma.academyAttempt.findMany({ ...(actor ? { where: { workspaceId: actor.workspaceId, ownerUserId: actor.userId } } : {}), orderBy: { createdAt: 'desc' }, take: 100 })).map(toAttempt) }
  }))
  app.post('/api/v1/academy/attempts', guarded(async (r, reply) => {
    const body = z.object({ lessonId: z.enum(['daily', 'weekly']), answers: z.array(z.number().int().min(0).max(2)).max(5) }).parse(r.body)
    const keys = body.lessonId === 'weekly' ? [1,0,1,0,1] : [1,0,1]
    if (body.answers.length !== keys.length) return reply.code(400).send({ message: 'Tüm sorular yanıtlanmalıdır.' })
    const now = DateTime.now().setZone('Europe/Istanbul')
    const period = (body.lessonId === 'weekly' ? now.startOf('week') : now).toFormat('yyyy-MM-dd')
    const score = Math.round(body.answers.filter((answer, i) => answer === keys[i]).length / keys.length * 100)
    const actor = getActorContext()
    const ownership = actor ? { workspaceId: actor.workspaceId, ownerUserId: actor.userId } : { workspaceId: null, ownerUserId: null }
    // A lower repeat score must not overwrite the user's best score for this period.
    const row = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`academy:${ownership.workspaceId}:${ownership.ownerUserId}:${body.lessonId}:${period}`}))`
      const existing = await tx.academyAttempt.findFirst({ where: { ...ownership, lessonId: body.lessonId, period } })
      if (existing && existing.score >= score) return existing
      return existing ? tx.academyAttempt.update({ where: { id: existing.id }, data: { answers: body.answers, score } }) : tx.academyAttempt.create({ data: { ...body, ...ownership, period, score } })
    })
    return reply.code(201).send(toAttempt(row))
  }))
}
