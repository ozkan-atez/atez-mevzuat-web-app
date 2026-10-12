import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { executeScanCommand } from '../../src/modules/scan-runs/application/execute-scan-command'
function database(status: string, sourceKeys: string[]) {
  const run = { id: 'run', status, sourceKeys }
  return { scanRun: { findUniqueOrThrow: vi.fn(async () => ({ ...run })), findUnique: vi.fn(async () => ({ ...run })), update: vi.fn(async ({ data }) => Object.assign(run, data)), updateMany: vi.fn(async ({ data }) => { Object.assign(run, data); return { count: 1 } }) }, source: { updateMany: vi.fn() }, sourceScanRun: { findMany: vi.fn().mockResolvedValue([]) }, run }
}
const command = { runId: 'run', outboxId: 'outbox', type: 'START_SCAN' as const }
describe('scan command lifecycle', () => {
  it('does not restart completed, cancelled, waiting or currently owned scans', async () => {
    for (const status of ['COMPLETED','CANCELLED','AWAITING_RETRY','RUNNING']) {
      const db = database(status, ['igmd']); const sources = vi.fn(); const gazette = vi.fn()
      await executeScanCommand(db as unknown as PrismaClient, command, 0, gazette, sources)
      expect(sources).not.toHaveBeenCalled(); expect(gazette).not.toHaveBeenCalled()
    }
  })
  it('claims a source-only scan before ingestion and completes its lifecycle', async () => {
    const db = database('QUEUED', ['igmd'])
    const sources = vi.fn(async () => {
      expect(db.run.status).toBe('RUNNING')
      return [{ sourceKey: 'igmd', sourceName: 'İGMD', status: 'COMPLETED', errorSummary: null, documentCount: 2 }]
    })
    const gazette = vi.fn()
    await executeScanCommand(db as unknown as PrismaClient, command, 0, gazette, sources)
    expect(db.run.status).toBe('COMPLETED'); expect(gazette).not.toHaveBeenCalled()
    expect(db.scanRun.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ totalItems: 2, completedItems: 2, completedAt: expect.any(Date) }) }))
  })
  it('keeps a partial-only source result partial without invoking Gazette', async () => {
    const db = database('QUEUED', ['ticaret-bakanligi']); const gazette = vi.fn()
    await executeScanCommand(db as unknown as PrismaClient, command, 0, gazette, vi.fn().mockResolvedValue([{ sourceKey: 'ticaret-bakanligi', sourceName: 'Ticaret Bakanlığı', status: 'PARTIAL', errorSummary: 'Tarihsiz PDF', documentCount: 0 }]))
    expect(db.run.status).toBe('PARTIAL'); expect(gazette).not.toHaveBeenCalled()
  })
  it('resumes a dead worker and reports unexpected ingestion errors as FAILED', async () => {
    const db = database('RUNNING', ['igmd']); const sources = vi.fn().mockRejectedValue(new Error('Source unavailable'))
    await expect(executeScanCommand(db as unknown as PrismaClient, command, 1, vi.fn(), sources)).rejects.toThrow('Source unavailable')
    expect(db.run.status).toBe('FAILED')
  })
  it('does not repeat source ingestion when retrying only the AI filter', async () => {
    const db = database('AWAITING_RETRY', ['resmi-gazete','igmd']); const sources = vi.fn(); const gazette = vi.fn(async () => { db.run.status = 'COMPLETED' })
    await executeScanCommand(db as unknown as PrismaClient, { ...command, type: 'RETRY_AI_FILTER' }, 0, gazette, sources)
    expect(sources).not.toHaveBeenCalled(); expect(gazette).toHaveBeenCalledOnce()
  })
  it('rejects an empty source selection instead of completing an empty job', async () => {
    const db = database('QUEUED', [])
    await expect(executeScanCommand(db as unknown as PrismaClient, command, 0, vi.fn(), vi.fn())).rejects.toThrow('etkin kaynak')
    expect(db.run.status).toBe('FAILED')
  })
  it('preserves earlier source failures after an AI-only retry succeeds', async () => {
    const db = database('AWAITING_RETRY', ['resmi-gazete','igmd'])
    db.sourceScanRun.findMany.mockResolvedValue([{ source: { name: 'İGMD', key: 'igmd' }, errorSummary: 'Unavailable' }])
    await executeScanCommand(db as unknown as PrismaClient, { ...command, type: 'RETRY_AI_FILTER' }, 0, async () => { db.run.status = 'COMPLETED' }, vi.fn())
    expect(db.run.status).toBe('PARTIAL')
    expect(db.scanRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'PARTIAL', errorSummary: 'İGMD: Unavailable' } }))
  })

})
