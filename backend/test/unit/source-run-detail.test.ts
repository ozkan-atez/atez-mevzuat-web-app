import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'
describe('selected source run detail', () => {
  it('includes external documents, decisions and counts in the parent review', async () => {
    const run = { id: 'parent', sourceKeys: ['igmd'], status: 'COMPLETED', targetDate: new Date('2026-10-11'), currentStage: null, stages: [], aiJobs: [], previousSourceJobs: [], topicProcesses: [], topicReports: [], editions: [], completedItems: 1, totalItems: 1, failedItems: 0,
      sourceRuns: [{ id: 'source-run', status: 'COMPLETED', source: { key: 'igmd', name: 'İGMD' }, _count: { documents: 1 }, documents: [{ id: 'doc', title: 'Duyuru', url: 'https://igmd.org.tr/doc', captureStatus: 'COMPLETED', capturedFiles: [{ status: 'STORED', role: 'ATTACHMENT' }], filterDecision: 'IN', filterReason: 'Gümrük işlemleri' }] }] }
    const prisma = { scanRun: { findUnique: vi.fn().mockResolvedValue(run) }, documentAsset: { count: vi.fn().mockResolvedValue(0) } }
    const detail = await new PrismaScanRepository(prisma as unknown as PrismaClient).getRun('parent')
    expect(detail).toMatchObject({ sourceKeys: ['igmd'], counts: { documents: 1, assets: 1 }, editions: [{ type: 'EXTERNAL', documents: [{ id: 'doc', validationStatus: 'VALID', filter: { finalDecision: 'IN' } }] }] })
  })
})
