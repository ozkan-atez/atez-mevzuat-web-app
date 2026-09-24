import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { executeScanRun } from '../../src/modules/scan-runs/application/execute-scan-run'
import { scanStages } from '../../src/modules/scan-runs/domain/scan-run'
import { scanRunsRoutes } from '../../src/modules/scan-runs/scan-runs.routes'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'

describe('existing scan retry', () => {
  it('updates only a failed run and enqueues START_SCAN for that same ID', async () => {
    const tx = {
      scanOutbox: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'command-1' }) },
      scanRun: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      stageExecution: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }
    const prisma = { $transaction: (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) }
    const repository = new PrismaScanRepository(prisma as never)
    expect(await repository.requestRunRetry('cron-1', 'retry-key')).toEqual({ runId: 'cron-1', commandId: 'command-1', status: 'QUEUED' })
    expect(tx.scanRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'cron-1', status: { in: ['FAILED', 'PARTIAL'] } } }))
    expect(tx.scanOutbox.create).toHaveBeenCalledWith({ data: { scanRunId: 'cron-1', commandType: 'START_SCAN', requestKey: 'retry-key' } })
    expect(tx.stageExecution.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { scanRunId: 'cron-1', status: 'FAILED' } }))
  })

  it('queues the existing run ID without creating a manual scan', async () => {
    const repository = {
      requestRunRetry: vi.fn().mockResolvedValue({ runId: 'cron-1', commandId: 'retry-1', status: 'QUEUED' }),
      createManualRun: vi.fn(),
    }
    const app = Fastify()
    await app.register(scanRunsRoutes, { repository: repository as unknown as PrismaScanRepository })
    const response = await app.inject({ method: 'POST', url: '/cron-1/retry', headers: { 'idempotency-key': crypto.randomUUID() } })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({ runId: 'cron-1', status: 'QUEUED' })
    expect(repository.requestRunRetry).toHaveBeenCalledWith('cron-1', expect.any(String))
    expect(repository.createManualRun).not.toHaveBeenCalled()
    await app.close()
  })

  it('continues at the first incomplete stage without fetching or reanalysing completed work', async () => {
    const runId = 'cron-1'
    const repository = {
      getExecutionRun: vi.fn().mockResolvedValue({
        id: runId, status: 'QUEUED', currentStage: 'WRITING_MANIFEST', targetDate: '2026-09-21',
        downloadedBytes: 123n, indexObjectKey: 'stored-index', indexSourceUrl: 'https://www.resmigazete.gov.tr/',
        stages: scanStages.slice(0, -1).map((stage) => ({ stage, status: 'COMPLETED' })),
      }),
      startRun: vi.fn(), startStage: vi.fn(), advanceStage: vi.fn(), completeStage: vi.fn(),
      completedSnapshot: vi.fn().mockResolvedValue({
        run: { id: runId, targetDate: '2026-09-21', startedAt: '2026-09-21T05:00:00Z', completedAt: null, sourceKeys: ['resmi-gazete'], sourceResults: [], editions: [] },
        index: { sourceUrl: 'https://www.resmigazete.gov.tr/', objectKey: 'stored-index', sha256: 'a'.repeat(64) },
        objects: [], filterAudit: null, previousSourceAudit: [], topicAnalysisAudit: { topics: [], noChangeReports: [] },
      }),
      verifyManifestCounts: vi.fn(), completeRun: vi.fn(),
      failStage: vi.fn().mockResolvedValue(undefined), failRun: vi.fn().mockResolvedValue(undefined),
    }
    const http = { download: vi.fn().mockRejectedValue(new Error('Completed work was repeated')) }
    const objectStore = {
      ensureBucket: vi.fn(),
      putRunFile: vi.fn().mockResolvedValue({ objectKey: `runs/2026/09/21/${runId}/manifest.json` }),
    }
    await executeScanRun(runId, {
      repository: repository as unknown as PrismaScanRepository,
      http: http as never,
      objectStore: objectStore as never,
      topicRepository: {} as never,
      aiModel: {} as never,
      previousSourceSearch: {} as never,
      maxRunBytes: 1_000n,
      gemini: { model: 'unused', maxAttempts: 1, maxContentBytes: 1, previousSourceConcurrency: 1, topicConcurrency: 1 },
    })
    expect(http.download).not.toHaveBeenCalled()
    expect(repository.startStage).toHaveBeenCalledWith(runId, 'WRITING_MANIFEST', 1)
    expect(repository.completeRun).toHaveBeenCalledWith(runId, `runs/2026/09/21/${runId}/manifest.json`)
  })
})
