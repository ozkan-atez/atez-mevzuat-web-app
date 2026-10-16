import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { PgBoss } from 'pg-boss'
import { automationSchema } from '../../src/modules/workspace/workspace.routes'
import { reconcileAutomationSchedules, runAutomation, validateAutomation } from '../../src/modules/workspace/automations'
import { scanSupported } from '../../src/modules/workspace/catalog'

const automation = { id: 'a1', name: 'Günlük', hour: 8, minute: 15, timezone: 'Europe/Istanbul', sourceIds: ['s1'], groupIds: [], templateId: null, isActive: true }
const mockPrisma = () => ({ source: { findMany: vi.fn().mockResolvedValue([{ id: 's1', baseUrl: 'https://www.resmigazete.gov.tr' }]) }, customerGroup: { count: vi.fn().mockResolvedValue(0) }, workspaceAutomation: { findMany: vi.fn().mockResolvedValue([automation]), findUniqueOrThrow: vi.fn().mockResolvedValue(automation), update: vi.fn() }, scanRun: { findUnique: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'run1', status: 'QUEUED' }) }, $transaction: vi.fn() })
describe('workspace automation', () => {
  it('rejects invalid daily times and time zones', () => {
    expect(automationSchema.safeParse({ ...automation, hour: 24 }).success).toBe(false)
    expect(automationSchema.safeParse({ ...automation, timezone: 'Invalid/Zone' }).success).toBe(false)
  })
  it('supports only the official Gazette scanner and rejects spoofed host names', () => {
    expect(scanSupported({ baseUrl: 'https://www.resmigazete.gov.tr' })).toBe(true)
    expect(scanSupported({ baseUrl: 'https://resmigazete.gov.tr.example.com' })).toBe(false)
  })
  it('supports configured official and professional feeds while requiring a Tariff account', () => {
    expect(scanSupported({ key: 'ticaret-bakanligi', baseUrl: 'https://ticaret.gov.tr', endpoints: [{ status: 'ACTIVE', adapter: 'TICARET_DUYURULAR' }] })).toBe(true)
    expect(scanSupported({ key: 'igmd', baseUrl: 'https://www.igmd.org.tr', endpoints: [{ status: 'PROPOSED', adapter: 'IGMD_MEVZUAT' }] })).toBe(false)
    expect(scanSupported({ key: 'unknown', baseUrl: 'https://example.com', endpoints: [{ status: 'ACTIVE', adapter: 'UNKNOWN' }] })).toBe(false)
  })
  it('rejects unsupported automated sources instead of pretending to scan them', async () => {
    const db = mockPrisma(); db.source.findMany.mockResolvedValue([{ id: 's1', baseUrl: 'https://tariff.com.tr' }])
    await expect(validateAutomation(db as unknown as PrismaClient, automation)).rejects.toThrow('bağlayıcısı')
  })
  it('removes legacy fixed schedules and reconciles managed automations', async () => {
    const db = mockPrisma()
    const queue = { getSchedules: vi.fn().mockResolvedValue([{ name: 'resmi-gazete-scheduled-scan', key: 'ANA_SAYI' }, { name: 'atez-workspace-daily-automation', key: 'deleted' }]), unschedule: vi.fn(), schedule: vi.fn() }
    await reconcileAutomationSchedules(db as unknown as PrismaClient, queue as unknown as PgBoss)
    expect(queue.unschedule).toHaveBeenCalledWith('resmi-gazete-scheduled-scan', 'ANA_SAYI')
    expect(queue.unschedule).toHaveBeenCalledWith('atez-workspace-daily-automation', 'deleted')
    expect(queue.unschedule).toHaveBeenCalledTimes(2)
    expect(queue.schedule).toHaveBeenCalledWith('atez-workspace-daily-automation', '15 8 * * *', { automationId: 'a1' }, { tz: 'Europe/Istanbul', key: 'a1' })
  })
  it('creates a real run and outbox with template/group snapshot requiring manual delivery approval', async () => {
    const db = mockPrisma(); db.$transaction.mockImplementation(async callback => callback(db))
    const run = await runAutomation(db as unknown as PrismaClient, 'a1', 'manual-request')
    expect(run.runId).toBe('run1')
    expect(db.scanRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ requestKey: 'automation:a1:manual:manual-request', automationId: 'a1', outbox: { create: { requestKey: 'automation:a1:manual:manual-request' } }, workspaceConfig: expect.objectContaining({ deliveryMode: 'MANUAL_APPROVAL' }) }) })
  })
  it('reuses the same run when the same request is retried', async () => {
    const db = mockPrisma(); db.$transaction.mockImplementation(async callback => callback(db)); db.scanRun.findUnique.mockResolvedValue({ id: 'existing', status: 'COMPLETED' })
    expect((await runAutomation(db as unknown as PrismaClient, 'a1', 'same-request')).runId).toBe('existing')
    expect(db.scanRun.create).not.toHaveBeenCalled()
  })
})

describe('recurring cron jobs', () => {
  it('rejects malformed, duplicate times and empty weekdays', () => {
    for (const changes of [{ times: ['24:00'] }, { times: ['08:00', '08:00'] }, { weekdays: [] }, { weekdays: [0] }]) {
      expect(automationSchema.safeParse({ ...automation, ...changes }).success).toBe(false)
    }
  })
  it('registers all selected times on selected weekdays and removes obsolete slots', async () => {
    const db = mockPrisma()
    db.workspaceAutomation.findMany.mockResolvedValue([{ ...automation, times: ['08:00', '18:30'], weekdays: [1, 5, 7], scheduleVersion: 2 } as any])
    const queue = { getSchedules: vi.fn().mockResolvedValue([{ name: 'atez-workspace-daily-automation', key: 'a1' }]), unschedule: vi.fn(), schedule: vi.fn() }
    await reconcileAutomationSchedules(db as unknown as PrismaClient, queue as unknown as PgBoss)
    expect(queue.unschedule).toHaveBeenCalledWith('atez-workspace-daily-automation', 'a1')
    expect(queue.schedule).toHaveBeenCalledWith('atez-workspace-daily-automation', '0 8 * * 0,1,5', { automationId: 'a1', version: 2 }, { tz: 'Europe/Istanbul', key: 'a1/0800' })
    expect(queue.schedule).toHaveBeenCalledWith('atez-workspace-daily-automation', '30 18 * * 0,1,5', { automationId: 'a1', version: 2 }, { tz: 'Europe/Istanbul', key: 'a1/1830' })
  })
  it('creates distinct runs per occurrence and preserves the original date on delayed deliveries', async () => {
    const db = mockPrisma(); db.$transaction.mockImplementation(async callback => callback(db))
    await runAutomation(db as unknown as PrismaClient, 'a1', undefined, '2026-10-05T05:00:00Z')
    await runAutomation(db as unknown as PrismaClient, 'a1', undefined, '2026-10-05T15:30:00Z')
    const data = db.scanRun.create.mock.calls.map(call => (call as any)[0].data)
    expect(data[0].requestKey).not.toBe(data[1].requestKey)
    expect(data[0].targetDate.toISOString()).toBe('2026-10-05T00:00:00.000Z')
  })
  it('removes all schedules when an automation is paused or deleted', async () => {
    const db = mockPrisma(); db.workspaceAutomation.findMany.mockResolvedValue([])
    const queue = { getSchedules: vi.fn().mockResolvedValue([{ name: 'atez-workspace-daily-automation', key: 'a1/0800' }, { name: 'atez-workspace-daily-automation', key: 'a1/1830' }]), unschedule: vi.fn(), schedule: vi.fn() }
    await reconcileAutomationSchedules(db as unknown as PrismaClient, queue as unknown as PgBoss)
    expect(queue.unschedule).toHaveBeenCalledTimes(2); expect(queue.schedule).not.toHaveBeenCalled()
  })
})
