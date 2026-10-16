import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { workspaceRoutes } from '../../src/modules/workspace/workspace.routes'

describe('automation history', () => {
  it('paginates and filters retained runs with report and source details, without fixed schedules', async () => {
    const run = { id: 'run1', automationId: 'removed', workspaceConfig: { automationName: 'Archived name' }, topicReports: [{ id: 'report1', title: 'Report' }] }
    const prisma = { workspaceAutomation: { findMany: vi.fn().mockResolvedValue([]), findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'removed' }) }, scanRun: { findMany: vi.fn().mockResolvedValue([run]), count: vi.fn().mockResolvedValue(11) } }
    const app = Fastify()
    await app.register(workspaceRoutes, { prisma: prisma as unknown as PrismaClient })
    try {
      const response = await app.inject('/api/v1/automations/removed?page=2&status=FAILED')
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ automation: { id: 'removed' }, runs: [run], total: 11 })
      expect(prisma.scanRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10, where: expect.objectContaining({ automationId: 'removed', status: 'FAILED' }), select: expect.objectContaining({ workspaceConfig: true, topicReports: expect.any(Object), sourceRuns: expect.any(Object) }) }))
      expect(prisma.scanRun.count).toHaveBeenCalledWith({ where: prisma.scanRun.findMany.mock.calls[0]![0].where })
      expect((await app.inject('/api/v1/automations/removed?page=0')).statusCode).toBe(400)
    } finally { await app.close() }
  })
})
