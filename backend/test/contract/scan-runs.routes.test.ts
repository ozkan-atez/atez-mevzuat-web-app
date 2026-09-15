import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'

const prisma = new PrismaClient()
const repository = new PrismaScanRepository(prisma)

describe('scan run HTTP contract', () => {
  beforeEach(() => prisma.scanRun.deleteMany())
  afterAll(() => prisma.$disconnect())

  it('accepts a valid manual scan and returns 202', async () => {
    const app = await buildApp({ scanRepository: repository })
    const response = await app.inject({
      method: 'POST', url: '/api/v1/scan-runs',
      headers: { 'idempotency-key': '55a7f2ac-2f19-4e1b-b46d-3ca1f1be3d42' },
      payload: { trigger: 'MANUAL', targetDate: '2026-07-11' },
    })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({ status: 'QUEUED', targetDate: '2026-07-11' })
    await app.close()
  })

  it('rejects an invalid calendar date', async () => {
    const app = await buildApp({ scanRepository: repository })
    const response = await app.inject({
      method: 'POST', url: '/api/v1/scan-runs',
      headers: { 'idempotency-key': crypto.randomUUID() },
      payload: { trigger: 'MANUAL', targetDate: '2026-02-30' },
    })
    expect(response.statusCode).toBe(400)
    await app.close()
  })

  it('returns a safe 404 for an unknown run', async () => {
    const app = await buildApp({ scanRepository: repository })
    const response = await app.inject({ method: 'GET', url: `/api/v1/scan-runs/${crypto.randomUUID()}` })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ message: 'Tarama bulunamadı' })
    await app.close()
  })

  it('lists recent real runs newest first', async () => {
    const older = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-09-13' })
    const newer = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-09-14' })
    const app = await buildApp({ scanRepository: repository })

    const response = await app.inject({ method: 'GET', url: '/api/v1/scan-runs?limit=10' })

    expect(response.statusCode).toBe(200)
    expect(response.json<{ runs: Array<{ id: string }> }>().runs.map((run) => run.id)).toEqual([newer.id, older.id])
    await app.close()
  })

  it('returns filter decisions without exposing confidence scores', async () => {
    const run = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-09-14' })
    const edition = await prisma.gazetteEdition.create({
      data: {
        scanRunId: run.id, publicationDate: new Date('2026-09-14T00:00:00.000Z'), type: 'MAIN',
        indexUrl: 'https://www.resmigazete.gov.tr/14.09.2026', discoveryOrder: 0,
        documents: { create: { title: 'İthalat Tebliği', sourceUrl: 'https://www.resmigazete.gov.tr/doc.htm', publicationOrder: 0 } },
      },
      include: { documents: true },
    })
    const job = await repository.getOrCreateDocumentFilterJob(run.id, {
      model: 'gemini-3.8-flash', titlePromptVersion: 'title-v1', contentPromptVersion: 'content-v1', configurationHash: 'a'.repeat(64),
    })
    await prisma.documentFilterDecision.create({
      data: {
        aiJobId: job.id, documentId: edition.documents[0]!.id, titleDecision: 'IN', titleReason: 'Başlık doğrudan ithalatla ilgili.',
        titleConfidence: 0.97, finalDecision: 'IN',
      },
    })
    await prisma.aiJob.update({ where: { id: job.id }, data: { status: 'COMPLETED' } })
    const app = await buildApp({ scanRepository: repository })

    const response = await app.inject({ method: 'GET', url: `/api/v1/scan-runs/${run.id}` })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      filter: { status: 'COMPLETED', counts: { in: 1, out: 0, pending: 0 }, retryAvailable: false },
      editions: [{ documents: [{ filter: { titleDecision: 'IN', finalDecision: 'IN', reason: 'Başlık doğrudan ithalatla ilgili.' } }] }],
    })
    expect(JSON.stringify(response.json())).not.toMatch(/confidence/i)
    await app.close()
  })

  it('queues an idempotent retry only for an AI filter awaiting retry', async () => {
    const run = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-09-14' })
    const job = await repository.getOrCreateDocumentFilterJob(run.id, {
      model: 'gemini-3.8-flash', titlePromptVersion: 'title-v1', contentPromptVersion: 'content-v1', configurationHash: 'a'.repeat(64),
    })
    await repository.markFilterRunning(run.id, job.id, 1)
    await repository.markFilterAwaitingRetry(run.id, job.id, { category: 'RATE_LIMITED', providerStatus: 429, message: 'Gemini geçici olarak yoğun.' })
    const app = await buildApp({ scanRepository: repository })
    const requestKey = crypto.randomUUID()

    const accepted = await app.inject({ method: 'POST', url: `/api/v1/scan-runs/${run.id}/ai-filter/retry`, headers: { 'idempotency-key': requestKey } })
    const repeated = await app.inject({ method: 'POST', url: `/api/v1/scan-runs/${run.id}/ai-filter/retry`, headers: { 'idempotency-key': requestKey } })
    const conflicting = await app.inject({ method: 'POST', url: `/api/v1/scan-runs/${run.id}/ai-filter/retry`, headers: { 'idempotency-key': crypto.randomUUID() } })

    expect(accepted.statusCode).toBe(202)
    expect(repeated.statusCode).toBe(202)
    expect(repeated.json()).toEqual(accepted.json())
    expect(conflicting.statusCode).toBe(409)
    expect(await prisma.scanOutbox.count({ where: { scanRunId: run.id, commandType: 'RETRY_AI_FILTER' } })).toBe(1)
    await app.close()
  })

  it('rejects AI filter retry for a run that is not paused', async () => {
    const run = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-09-14' })
    const app = await buildApp({ scanRepository: repository })
    const response = await app.inject({ method: 'POST', url: `/api/v1/scan-runs/${run.id}/ai-filter/retry`, headers: { 'idempotency-key': crypto.randomUUID() } })
    expect(response.statusCode).toBe(409)
    await app.close()
  })

  it('queues an idempotent retry for incomplete previous source jobs only', async () => {
    const run = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-09-14' })
    const edition = await prisma.gazetteEdition.create({
      data: {
        scanRunId: run.id, publicationDate: new Date('2026-09-14T00:00:00.000Z'), type: 'MAIN',
        indexUrl: 'https://www.resmigazete.gov.tr/14.09.2026', discoveryOrder: 0,
        documents: { create: { title: 'İthalat Tebliği', sourceUrl: 'https://www.resmigazete.gov.tr/doc.htm', publicationOrder: 0 } },
      }, include: { documents: true },
    })
    await prisma.previousSourceJob.create({
      data: {
        scanRunId: run.id, documentId: edition.documents[0]!.id, status: 'AWAITING_RETRY',
        model: 'gemini-3.7-flash', promptVersion: 'previous-source-preflight-v1', configurationHash: 'b'.repeat(64),
      },
    })
    await prisma.stageExecution.create({
      data: { scanRunId: run.id, stage: 'DISCOVERING_PREVIOUS_SOURCES', status: 'AWAITING_RETRY', totalItems: 1, failedItems: 1 },
    })
    await prisma.scanRun.update({ where: { id: run.id }, data: { status: 'AWAITING_RETRY', currentStage: 'DISCOVERING_PREVIOUS_SOURCES' } })
    const app = await buildApp({ scanRepository: repository })
    const requestKey = crypto.randomUUID()

    const accepted = await app.inject({ method: 'POST', url: `/api/v1/scan-runs/${run.id}/previous-sources/retry`, headers: { 'idempotency-key': requestKey } })
    const repeated = await app.inject({ method: 'POST', url: `/api/v1/scan-runs/${run.id}/previous-sources/retry`, headers: { 'idempotency-key': requestKey } })

    expect(accepted.statusCode).toBe(202)
    expect(repeated.json()).toEqual(accepted.json())
    expect(await prisma.scanOutbox.count({ where: { scanRunId: run.id, commandType: 'RETRY_PREVIOUS_SOURCES' } })).toBe(1)
    expect(await prisma.previousSourceJob.findFirstOrThrow()).toMatchObject({ status: 'QUEUED' })
    await app.close()
  })

  it('does not offer previous-source retry while sibling jobs are still running', async () => {
    const run = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-09-14' })
    const edition = await prisma.gazetteEdition.create({
      data: {
        scanRunId: run.id, publicationDate: new Date('2026-09-14T00:00:00.000Z'), type: 'MAIN',
        indexUrl: 'https://www.resmigazete.gov.tr/14.09.2026', discoveryOrder: 0,
        documents: { create: [
          { title: 'İlk belge', sourceUrl: 'https://www.resmigazete.gov.tr/1.htm', publicationOrder: 0 },
          { title: 'İkinci belge', sourceUrl: 'https://www.resmigazete.gov.tr/2.htm', publicationOrder: 1 },
        ] },
      }, include: { documents: true },
    })
    await prisma.previousSourceJob.createMany({ data: [
      { scanRunId: run.id, documentId: edition.documents[0]!.id, status: 'AWAITING_RETRY', model: 'gemini-3.7-flash', promptVersion: 'v1', configurationHash: 'a'.repeat(64) },
      { scanRunId: run.id, documentId: edition.documents[1]!.id, status: 'RUNNING', model: 'gemini-3.7-flash', promptVersion: 'v1', configurationHash: 'a'.repeat(64) },
    ] })
    await prisma.scanRun.update({ where: { id: run.id }, data: { status: 'RUNNING', currentStage: 'DISCOVERING_PREVIOUS_SOURCES' } })
    const app = await buildApp({ scanRepository: repository })

    const response = await app.inject({ method: 'GET', url: `/api/v1/scan-runs/${run.id}` })

    expect(response.json()).toMatchObject({ previousSources: { status: 'RUNNING', retryAvailable: false } })
    await app.close()
  })

  it('exposes today\'s scheduled slots with their runs for the dashboard', async () => {
    const created = await repository.createScheduledRun({ targetDate: todayInIstanbul(), slotKey: 'ANA_SAYI' })
    const repeated = await repository.createScheduledRun({ targetDate: todayInIstanbul(), slotKey: 'ANA_SAYI' })
    const app = await buildApp({ scanRepository: repository, timezone: 'Europe/Istanbul' })

    const response = await app.inject({ method: 'GET', url: '/api/v1/scan-runs/schedule' })

    expect(response.statusCode).toBe(200)
    const slots = response.json().slots as Array<{ key: string; time: string; run: { id: string } | null }>
    expect(slots.map((slot) => slot.time)).toEqual(['05:00', '10:00', '15:00', '23:00'])
    expect(slots[0]?.run?.id).toBe(created.id)
    // A second firing of the same slot must reuse the run, never scan twice.
    expect(repeated.id).toBe(created.id)
    expect(repeated.created).toBe(false)
    expect(slots.slice(1).every((slot) => slot.run === null)).toBe(true)
    await app.close()
  })
})

function todayInIstanbul(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
