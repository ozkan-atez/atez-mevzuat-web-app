import Fastify from 'fastify'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { reportsRoutes } from '../../src/modules/reports/reports.routes'
import { runWithActorContext, permissionsForRole, type ActorContext } from '../../src/platform/actor-context'

describe.skipIf(!process.env.TEST_DATABASE_URL)('unified report list scope and production origin', () => {
  const prisma = new PrismaClient(), suffix = randomUUID(), app = Fastify(), userId = randomUUID(), otherId = randomUUID()
  let workspaceId: string, actor: ActorContext
  const runIds: string[] = [], reportIds: string[] = []
  beforeAll(async () => {
    workspaceId = (await prisma.workspace.upsert({ where: { key: 'atez' }, create: { key: 'atez', name: 'Test' }, update: {} })).id
    await prisma.user.createMany({ data: [{ id: userId, email: `${userId}@example.invalid` }, { id: otherId, email: `${otherId}@example.invalid` }] })
    actor = { userId, identityId: 'test', workspaceId, issuer: 'https://test.invalid', subject: userId, role: 'EDITOR', permissions: permissionsForRole('EDITOR') }
    for (const [index, origin] of ['MANUAL', 'AUTOMATION', 'PRIVATE_OTHER'].entries()) {
      const run = await prisma.scanRun.create({ data: { requestKey: `${suffix}-${index}`, targetDate: new Date('2026-10-12'), trigger: 'MANUAL', automationId: origin === 'AUTOMATION' ? 'deleted-automation' : null } })
      runIds.push(run.id)
      const report = await prisma.topicReport.create({ data: { scanRunId: run.id, workspaceId, ownerUserId: origin === 'PRIVATE_OTHER' ? otherId : userId, visibility: 'PRIVATE', title: `${suffix}-${origin}`, basename: suffix, card: 'K6', latestVersion: 2 } })
      reportIds.push(report.id)
    }
    await app.register(reportsRoutes, { prefix: '/api/v1', prisma }); await app.ready()
  })
  afterAll(async () => { await app.close(); await prisma.scanRun.deleteMany({ where: { id: { in: runIds } } }); await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } }); await prisma.$disconnect() })
  it('keeps manually started automation reports automated and filters before paginating', async () => {
    await runWithActorContext(actor, async () => {
      const response = await app.inject(`/api/v1/reports?query=${suffix}&origin=AUTOMATION&pageSize=1`)
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ total: 1, reports: [{ id: reportIds[1], origin: 'AUTOMATION', version: 2, contentType: 'NO_CHANGE' }] })
      const manual = await app.inject(`/api/v1/reports?query=${suffix}&origin=MANUAL`)
      expect(manual.json()).toMatchObject({ total: 1, reports: [{ id: reportIds[0], origin: 'MANUAL' }] })
      const all = await app.inject(`/api/v1/reports?query=${suffix}&pageSize=1&page=2`)
      expect(all.json().total).toBe(2); expect(all.json().reports).toHaveLength(1)
      expect(JSON.stringify(all.json())).not.toContain(reportIds[2])
    })
  })
})
