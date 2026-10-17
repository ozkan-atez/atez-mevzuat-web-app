import Fastify from 'fastify'
import { PgBoss } from 'pg-boss'
import { PrismaClient } from '@prisma/client'
import { DateTime } from 'luxon'
import { createHash } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { RabbitQueue, sourceQueueName } from '../../src/platform/rabbitmq'
import { manualScanQueueName } from '../../src/platform/queue'
import { workspaceRoutes } from '../../src/modules/workspace/workspace.routes'
import { sourceScanRunRoutes } from '../../src/modules/managed-sources/source-scan-runs.routes'
import { dispatchSourceRuns, executeSourceCommand } from '../../src/modules/managed-sources/source-job'
import { executeScanCommand } from '../../src/modules/scan-runs/application/execute-scan-command'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'
import { executeAutomationCommand, reconcileAutomationSchedules, workspaceAutomationQueue } from '../../src/modules/workspace/automations'
import { runSelectedSources } from '../../src/modules/managed-sources/run-selected-sources'
import type { SourceProcessingDependencies } from '../../src/modules/managed-sources/process-source-documents'

// Sources are collected through their verified profile and a source session; the network is the fixture boundary.
const fixture = vi.hoisted(() => ({ failing: false, listings: 0 }))
const feedUrl = 'https://example.com/feed'
vi.mock('../../src/modules/managed-sources/source-session', () => ({
  openSourceSession: async () => ({
    html: async (url: string) => {
      if (url !== feedUrl) throw new Error(`Unexpected listing ${url}`)
      fixture.listings++
      if (fixture.failing) throw new Error('Fixture temporary outage')
      // One dated row for today (automation runs) and one for the standalone run's target day.
      const today = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date())
      return `<article><a href="/document">Fixture mevzuat</a><time>${today}</time></article><article><a href="/archived">Fixture mevzuat arşivi</a><time>11.09.2026</time></article>`
    },
    binary: async (url: string) => ({ body: Buffer.from('<html><body>Fixture mevzuat değişikliği metni.</body></html>'), contentType: 'text/html', finalUrl: url }),
    close: async () => {},
  }),
}))
// AI filtering and report generation have their own integration coverage (external-source-pipeline);
// here they only need to settle every captured document.
vi.mock('../../src/modules/managed-sources/process-source-documents', () => ({
  processSourceDocuments: async (prisma: PrismaClient, runId: string) => {
    const updated = await prisma.sourceScanDocument.updateMany({ where: { runId }, data: { processingStatus: 'COMPLETED', filterDecision: 'IN' } })
    return { failures: [], readyReports: updated.count }
  },
}))
const processing = {
  objectStore: { putRunFile: async (key: string, bytes: Buffer, mediaType: string) => ({ bucket: 'test', objectKey: key, sha256: createHash('sha256').update(bytes).digest('hex'), mediaType, byteSize: BigInt(bytes.length) }) },
  maxRunBytes: 1_000_000n,
} as unknown as SourceProcessingDependencies
const enabled = Boolean(process.env.RABBITMQ_TEST_URL)
if (enabled) process.env.RABBITMQ_URL = process.env.RABBITMQ_TEST_URL!
describe.skipIf(!enabled)('real cron and manual job workflow', () => {
  it('fires the real clock, drains the outbox and produces reports; manual source retries ignore old messages', async () => {
    const prisma = new PrismaClient()
    const app = Fastify()
    const clock = new PgBoss({ connectionString: process.env.DATABASE_URL!, cronMonitorIntervalSeconds: 1, cronWorkerIntervalSeconds: 1 })
    const broker = new RabbitQueue()
    const repository = new PrismaScanRepository(prisma)
    let timer: ReturnType<typeof setInterval> | undefined
    let dispatching = false
    const dispatch = async () => {
      if (dispatching) return
      dispatching = true
      try {
        for (const row of await repository.claimPendingOutbox(20)) {
          const id = await broker.send(manualScanQueueName, { outboxId: row.id, runId: row.scanRunId, type: row.commandType }, { singletonKey: row.id })
          await repository.markOutboxDispatched(row.id, id)
        }
      } finally { dispatching = false }
    }
    let automationId: string | undefined
    try {
      await clock.start(); await clock.createQueue(workspaceAutomationQueue)
      await app.register(workspaceRoutes, { prisma })
      await app.register(sourceScanRunRoutes, { prefix: '/api/v1/source-scan-runs', prisma })
      const source = await prisma.source.create({ data: { key: crypto.randomUUID(), name: 'Workflow fixture', baseUrl: 'https://example.com', authorityType: 'REFERENCE', profiles: { create: { version: 1, status: 'VERIFIED', config: { name: 'Workflow fixture', transport: 'HTTP', allowedHosts: ['example.com'], feeds: [{ url: feedUrl, title: 'Fixture', row: 'article', link: 'a', date: 'time' }], auth: { mode: 'NONE' }, maxPages: 1, maxDocuments: 10, delayMs: 300 } } } } })
      await broker.work(manualScanQueueName, async jobs => {
        for (const job of jobs) await executeScanCommand(prisma, job.data, job.retryCount, async () => { throw new Error('Source-only run unexpectedly scanned Gazette') }, (client, runId) => runSelectedSources(client, runId, processing))
      })
      await broker.work(workspaceAutomationQueue, async jobs => { for (const job of jobs) await executeAutomationCommand(prisma, job.data) })
      await broker.work(sourceQueueName, async jobs => { for (const job of jobs) await executeSourceCommand(prisma, job.data, job.retryCount, processing) })
      await clock.work(workspaceAutomationQueue, { includeMetadata: true, pollingIntervalSeconds: 1 }, async jobs => {
        for (const job of jobs) await broker.send(workspaceAutomationQueue, { ...(job.data as object), scheduledAt: job.createdOn.toISOString() }, { singletonKey: job.id })
      })
      const due = DateTime.now().setZone('Europe/Istanbul').plus({ minutes: 1 }).startOf('minute')
      const created = await app.inject({ method: 'POST', url: '/api/v1/automations', payload: { name: 'Workflow cron fixture', sourceIds: [source.id], times: [due.toFormat('HH:mm')] } })
      expect(created.statusCode).toBe(201); automationId = created.json().id
      await reconcileAutomationSchedules(prisma, clock)
      const manualKey = crypto.randomUUID()
      const manual = () => app.inject({ method: 'POST', url: `/api/v1/automations/${automationId}/run`, payload: { requestKey: manualKey } })
      const responses = await Promise.all([manual(), manual()])
      expect(responses.map(response => response.statusCode)).toEqual([200,200])
      const manualId = responses[0]!.json().runId
      expect(responses[1]!.json().runId).toBe(manualId)
      await dispatch(); timer = setInterval(() => void dispatch(), 500)
      await expect.poll(async () => (await prisma.scanRun.findUnique({ where: { id: manualId } }))?.status, { timeout: 5000 }).toBe('COMPLETED')
      const manualRun = await prisma.scanRun.findUniqueOrThrow({ where: { id: manualId }, include: { sourceRuns: true } })
      expect(manualRun.startedAt).not.toBeNull(); expect(manualRun.totalItems).toBe(1)
      expect(await prisma.sourceScanDocument.findMany({ where: { runId: manualRun.sourceRuns[0]!.id }, select: { title: true, processingStatus: true } })).toEqual([{ title: 'Fixture mevzuat', processingStatus: 'COMPLETED' }])
      // Wait for a real cron occurrence, without inserting a trigger message by hand.
      await expect.poll(async () => prisma.scanRun.findFirst({ where: { automationId: automationId!, trigger: 'CRON', status: 'COMPLETED' } }), { timeout: 75000, interval: 500 }).not.toBeNull()
      expect(await prisma.scanRun.count({ where: { automationId: automationId!, trigger: 'CRON' } })).toBe(1)
      expect(fixture.listings).toBe(2)
      fixture.failing = true
      const standalone = await app.inject({ method: 'POST', url: '/api/v1/source-scan-runs/', headers: { 'idempotency-key': crypto.randomUUID() }, payload: { sourceId: source.id, targetDate: '2026-09-11' } })
      expect(standalone.statusCode).toBe(202)
      const sourceRunId = standalone.json().runId
      await dispatchSourceRuns(prisma, broker)
      const oldId = `source:${sourceRunId}:0`
      await expect.poll(async () => (await prisma.backgroundJob.findUnique({ where: { id: oldId } }))?.status).toBe('RETRY')
      fixture.failing = false
      const retried = await app.inject({ method: 'POST', url: `/api/v1/source-scan-runs/${sourceRunId}/retry` })
      expect(retried.statusCode).toBe(202)
      await dispatchSourceRuns(prisma, broker)
      await broker.publish(sourceQueueName, { id: oldId, data: { runId: sourceRunId, version: 0 }, retryCount: 1 })
      await expect.poll(async () => (await prisma.sourceScanRun.findUnique({ where: { id: sourceRunId } }))?.status).toBe('COMPLETED')
      expect(fixture.listings).toBe(4)
    } finally {
      if (timer) clearInterval(timer)
      if (automationId) { await prisma.workspaceAutomation.deleteMany({ where: { id: automationId } }); await reconcileAutomationSchedules(prisma, clock) }
      await clock.stop(); await broker.close()
      await app.close(); await prisma.$disconnect()
    }
  }, 90000)
})
