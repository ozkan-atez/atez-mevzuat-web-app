import { startQueue, manualScanQueueName } from './platform/queue'
import { prisma } from './platform/database'
import { loadEnv } from './config/env'
import { PrismaScanRepository } from './modules/scan-runs/infrastructure/prisma-scan-repository'
import { PgBossScanQueue } from './modules/scan-runs/infrastructure/scan-run-queue'
import { S3ObjectStore } from './modules/scan-runs/infrastructure/s3-object-store'
import { OfficialHttpClient } from './modules/scan-runs/infrastructure/official-http-client'
import { SourcePolicy } from './modules/scan-runs/domain/source-policy'
import { executeScanRun } from './modules/scan-runs/application/execute-scan-run'

async function startWorker() {
  const queue = await startQueue()
  const env = loadEnv()
  const repository = new PrismaScanRepository(prisma)
  const scanQueue = new PgBossScanQueue(queue)
  const objectStore = new S3ObjectStore(env.s3)
  const http = new OfficialHttpClient(new SourcePolicy(env.sourceHosts), {
    delayMs: env.sourceDelayMs,
    timeoutMs: env.sourceTimeoutMs,
    maxAttempts: env.sourceMaxAttempts,
    maxFileBytes: env.maxFileBytes,
  })
  await objectStore.ensureBucket()

  const dispatch = async () => {
    const rows = await repository.claimPendingOutbox(10)
    for (const row of rows) {
      try {
        const queueJobId = await scanQueue.enqueue(row.scanRunId)
        await repository.markOutboxDispatched(row.id, queueJobId)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Queue dispatch failed'
        const delay = Math.min(60_000, 1_000 * 2 ** row.attempts)
        await repository.deferOutbox(row.id, message, new Date(Date.now() + delay))
      }
    }
  }
  await dispatch()
  setInterval(() => void dispatch().catch((error) => console.error('Outbox dispatch error:', error)), 1_000)

  await queue.work(manualScanQueueName, async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs]
    for (const job of jobList) {
      const runId = String((job.data as { runId: string }).runId)
      await executeScanRun(runId, { repository, http, objectStore, maxRunBytes: BigInt(env.maxRunBytes) })
    }
  })
}

startWorker().catch(err => {
  console.error('Worker başlatılırken hata oluştu:', err)
  process.exit(1)
})
