import Fastify from 'fastify'
import { PgBoss } from 'pg-boss'
import { PrismaClient } from '@prisma/client'
import { describe, it, expect } from 'vitest'
import { workspaceRoutes } from '../../src/modules/workspace/workspace.routes'
import { executeAutomationCommand, reconcileAutomationSchedules, workspaceAutomationQueue } from '../../src/modules/workspace/automations'

describe('persisted cron lifecycle', () => {
  it('creates multiple schedules, rejects stale commands, pauses and deletes them', async () => {
    const prisma = new PrismaClient()
    const app = Fastify()
    const queue = new PgBoss(process.env.DATABASE_URL!)
    await queue.start()
    await queue.createQueue(workspaceAutomationQueue)
    await app.register(workspaceRoutes, { prisma })
    const source = await prisma.source.upsert({ where: { key: 'resmi-gazete' }, update: { isActive: true }, create: { key: 'resmi-gazete', baseUrl: 'https://www.resmigazete.gov.tr', name: 'Resmî Gazete', authorityType: 'OFFICIAL' } })
    let id: string | undefined
    try {
      const created = await app.inject({ method: 'POST', url: '/api/v1/automations', payload: { name: 'Cron test', sourceIds: [source.id], times: ['08:00','18:30'], weekdays: [1,5,7] } })
      expect(created.statusCode).toBe(201); id = created.json().id
      await reconcileAutomationSchedules(prisma, queue)
      expect((await prisma.workspaceAutomation.findUniqueOrThrow({ where: { id: id! } })).lastError).toBeNull()
      const schedules = (await queue.getSchedules()).filter(s => s.key?.startsWith(`${id}/`))
      expect(schedules.map(s => s.cron).sort()).toEqual(['0 8 * * 0,1,5','30 18 * * 0,1,5'])
      const before = created.json().scheduleVersion
      const updated = await app.inject({ method: 'PATCH', url: `/api/v1/automations/${id}`, payload: { times: ['12:00'] } })
      expect(updated.json().scheduleVersion).toBe(before + 1)
      await executeAutomationCommand(prisma, { automationId: id!, scheduledAt: '2026-10-06T05:00:00Z', version: before })
      expect(await prisma.scanRun.count({ where: { automationId: id! } })).toBe(0)
      await executeAutomationCommand(prisma, { automationId: id!, scheduledAt: '2026-10-06T09:00:00Z', version: before + 1 })
      await executeAutomationCommand(prisma, { automationId: id!, scheduledAt: '2026-10-06T09:00:00Z', version: before + 1 })
      expect(await prisma.scanRun.count({ where: { automationId: id! } })).toBe(1)
      const paused = await app.inject({ method: 'PATCH', url: `/api/v1/automations/${id}`, payload: { isActive: false } })
      expect(paused.statusCode).toBe(200)
      await reconcileAutomationSchedules(prisma, queue)
      expect((await queue.getSchedules()).filter(s => s.key?.startsWith(`${id}/`))).toEqual([])
      await executeAutomationCommand(prisma, { automationId: id!, scheduledAt: '2026-10-07T09:00:00Z', version: paused.json().scheduleVersion })
      expect(await prisma.scanRun.count({ where: { automationId: id! } })).toBe(1)
      expect((await app.inject({ method: 'DELETE', url: `/api/v1/automations/${id}` })).statusCode).toBe(204)
      await executeAutomationCommand(prisma, { automationId: id!, scheduledAt: '2026-10-07T09:00:00Z' })
      expect((await app.inject({ method: 'GET', url: `/api/v1/automations/${id}` })).statusCode).toBe(404)
    } finally {
      if (id) { await prisma.workspaceAutomation.deleteMany({ where: { id } }); await prisma.scanRun.deleteMany({ where: { automationId: id! } }) }
      await app.close(); await queue.stop(); await prisma.$disconnect()
    }
  })
})
