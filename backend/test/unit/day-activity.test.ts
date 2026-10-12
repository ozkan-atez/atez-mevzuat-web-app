import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { DateTime } from 'luxon'
import { getDayActivity } from '../../src/modules/workspace/day-activity'
import { runWithActorContext, type ActorContext } from '../../src/platform/actor-context'

const now = DateTime.utc(2026, 10, 11, 21, 30)
const actor: ActorContext = { userId: 'me', workspaceId: 'company', identityId: 'identity', role: 'VIEWER', permissions: ['workspace.read', 'report.read', 'chat.read'], issuer: 'test', subject: 'test' }
function database() {
  return { reportRevision: { findMany: vi.fn<(args: any) => Promise<any>>().mockResolvedValue([]), findFirst: vi.fn<(args: any) => Promise<any>>().mockResolvedValue(null), count: vi.fn<(args: any) => Promise<any>>().mockResolvedValue(0) }, chatSession: { findMany: vi.fn<(args: any) => Promise<any>>().mockResolvedValue([]), count: vi.fn<(args: any) => Promise<any>>().mockResolvedValue(0) }, scanRun: { findMany: vi.fn<(args: any) => Promise<any>>().mockResolvedValue([]), count: vi.fn<(args: any) => Promise<any>>().mockResolvedValue(0) } }
}
describe('day activity', () => {
  it('uses Istanbul midnight and preserves report, chat and workspace access boundaries', async () => {
    const db = database()
    await runWithActorContext(actor, () => getDayActivity(db as unknown as PrismaClient, 1, undefined, now))
    const where = db.reportRevision.findMany.mock.calls[0]![0].where
    expect(where.createdAt.gte.toISOString()).toBe('2026-10-11T21:00:00.000Z')
    expect(where.createdAt.lte.toISOString()).toBe('2026-10-11T21:30:00.000Z')
    expect(where.report.AND[0]).toEqual({ workspaceId: 'company', OR: [{ visibility: 'PRIVATE', ownerUserId: 'me' }, { visibility: 'WORKSPACE' }] })
    expect(where.report.AND[1].OR[1]).toEqual({ actorScope: 'workspace:company:user:me' })
    expect(db.chatSession.findMany.mock.calls[0]![0].where).toMatchObject({ workspaceId: 'company', ownerId: 'me', visibility: 'PRIVATE', messages: { some: {} } })
    expect(db.scanRun.findMany.mock.calls[0]![0].where.workspaceId).toBe('company')
    expect(db.reportRevision.findFirst.mock.calls[0]![0].where.report).toEqual(where.report)
  })
  it('returns the most recent report even outside the range and sorts activities with change summaries', async () => {
    const db = database()
    const report = { id: 'r', title: 'Gümrük raporu', topicId: 't', scanRunId: 's', operationTaskId: null }
    db.reportRevision.findMany.mockResolvedValue([{ id: 'v2', version: 2, createdAt: new Date('2026-10-11T21:20:00Z'), report, draft: { edits: [{ path: 'summary' }, { path: 'summary' }, { path: 'sources' }] } }])
    db.chatSession.findMany.mockResolvedValue([{ id: 'c', title: 'GTİP sohbeti', updatedAt: new Date('2026-10-11T21:25:00Z'), _count: { messages: 8 } }])
    db.reportRevision.findFirst.mockResolvedValue({ id: 'old', version: 3, createdAt: new Date('2026-10-01T10:00:00Z'), report })
    const result = await getDayActivity(db as unknown as PrismaClient, 1, undefined, now)
    expect(result.items.map(item => item.kind)).toEqual(['CHAT', 'REVISION'])
    expect(result.items[1]).toMatchObject({ detail: 'Özet, Kaynaklar güncellendi', href: '/reports/t', version: 2 })
    expect(result.latestReport?.at).toBe('2026-10-01T10:00:00.000Z')
  })
  it('filters revisions on the server and uses seven calendar days', async () => {
    const db = database()
    await getDayActivity(db as unknown as PrismaClient, 7, 'REVISION', now)
    expect(db.reportRevision.findMany.mock.calls[0]![0].where.version).toEqual({ gt: 1 })
    expect(db.reportRevision.findMany.mock.calls[0]![0].where.createdAt.gte.toISOString()).toBe('2026-10-05T21:00:00.000Z')
    expect(db.chatSession.findMany).not.toHaveBeenCalled()
    expect(db.scanRun.findMany).not.toHaveBeenCalled()
  })
  it('does not query reports or conversations without their read permission', async () => {
    const db = database()
    const result = await runWithActorContext({ ...actor, permissions: ['workspace.read'] }, () => getDayActivity(db as unknown as PrismaClient, 1, undefined, now))
    expect(db.reportRevision.findMany).not.toHaveBeenCalled()
    expect(db.reportRevision.findFirst).not.toHaveBeenCalled()
    expect(db.reportRevision.count).not.toHaveBeenCalled()
    expect(db.chatSession.findMany).not.toHaveBeenCalled()
    expect(result.latestReport).toBeNull()
  })
})
