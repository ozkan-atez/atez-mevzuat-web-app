import { it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'

it('returns actual multi-source outputs in the parent scan without copying report HTML', async () => {
  const prisma = {
    scanRun: { findUnique: vi.fn().mockResolvedValue({ id: 'parent', status: 'PARTIAL', currentStage: null, targetDate: new Date('2026-10-05'), startedAt: null, completedAt: null, errorSummary: null, aiJobs: [], previousSourceJobs: [], topicProcesses: [], topicReports: [], editions: [], stages: [], totalItems: 0, completedItems: 0, failedItems: 0, sourceRuns: [{ id: 'source-run', status: 'COMPLETED', source: { name: null, key: 'igmd' }, _count: { documents: 2 }, errorSummary: null }] }) },
    documentAsset: { count: vi.fn().mockResolvedValue(0) },
  }
  const result = await new PrismaScanRepository(prisma as unknown as PrismaClient).getRun('parent')
  expect(result?.sourceRuns).toEqual([{ id: 'source-run', status: 'COMPLETED', source: { name: 'igmd', key: 'igmd' }, documentCount: 2, errorSummary: null, stages: undefined, notes: [] }])
  expect(JSON.stringify(result)).not.toContain('reportHtml')
})
