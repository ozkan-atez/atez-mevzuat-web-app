import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'

const prisma = new PrismaClient()
const repository = new PrismaScanRepository(prisma)
const configuration = {
  model: 'gemini-3.8-flash',
  titlePromptVersion: 'document-filter-title-v1',
  contentPromptVersion: 'document-filter-content-v1',
  configurationHash: 'a'.repeat(64),
}

async function createRunWithDocuments() {
  const run = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-09-14' })
  await repository.saveEditions(run.id, run.targetDate, [{
    type: 'MAIN', supplementNo: null, indexUrl: 'https://www.resmigazete.gov.tr/14.09.2026', discoveryOrder: 0,
    documents: [
      { title: 'Belirsiz düzenleme', sourceUrl: 'https://www.resmigazete.gov.tr/1.htm', publicationOrder: 1 },
      { title: 'İthalat kararı', sourceUrl: 'https://www.resmigazete.gov.tr/2.htm', publicationOrder: 2 },
    ],
  }])
  return run
}

describe('document filter repository', () => {
  beforeEach(() => prisma.scanRun.deleteMany())
  afterAll(() => prisma.$disconnect())

  it('persists title decisions atomically and resolves MAYBE from content', async () => {
    const run = await createRunWithDocuments()
    const job = await repository.getOrCreateDocumentFilterJob(run.id, configuration)
    const documents = await repository.listFilterDocuments(run.id)
    await repository.markFilterRunning(run.id, job.id, documents.length)

    await repository.saveTitleDecisions(job.id, [
      { documentId: documents[0]!.id, decision: 'MAYBE', reason: 'İçerik gerekli.', confidence: 0.55 },
      { documentId: documents[1]!.id, decision: 'IN', reason: 'İthalatı düzenliyor.', confidence: 0.97 },
    ])

    expect(await repository.getFilterProgress(job.id)).toMatchObject({
      titlePassComplete: true,
      unresolvedDocumentIds: [documents[0]!.id],
      finalCounts: { in: 1, out: 0, pending: 1 },
    })
    expect((await prisma.documentFilterDecision.findFirstOrThrow({ where: { documentId: documents[1]!.id } })).titleConfidence).toBe(0.97)

    const contentCall = await repository.startAiCall({ aiJobId: job.id, phase: 'CONTENT', batchKey: 'batch-1', attemptNo: 1, inputHash: 'd'.repeat(64) })
    await repository.completeAiCall(contentCall.id, { providerRequestId: 'provider-content', inputTokens: 30, outputTokens: 6, latencyMs: 140 })
    await repository.saveContentDecisions(job.id, 'batch-1', [
      { documentId: documents[0]!.id, decision: 'OUT', reason: 'Dış ticaret etkisi yok.', confidence: 0.91 },
    ])

    expect(await repository.getFilterProgress(job.id)).toMatchObject({
      unresolvedDocumentIds: [],
      completedContentBatchKeys: ['batch-1'],
      finalCounts: { in: 1, out: 1, pending: 0 },
    })
  })

  it('rolls back the whole title response when a document is outside the run', async () => {
    const run = await createRunWithDocuments()
    const otherRun = await createRunWithDocuments()
    const job = await repository.getOrCreateDocumentFilterJob(run.id, configuration)
    const documents = await repository.listFilterDocuments(run.id)
    const outside = await repository.listFilterDocuments(otherRun.id)

    await expect(repository.saveTitleDecisions(job.id, [
      { documentId: documents[0]!.id, decision: 'OUT', reason: 'İlgisiz.', confidence: 0.8 },
      { documentId: outside[0]!.id, decision: 'IN', reason: 'Yanlış run.', confidence: 0.8 },
    ])).rejects.toThrow('do not belong')
    expect(await prisma.documentFilterDecision.count({ where: { aiJobId: job.id } })).toBe(0)
  })

  it('records completed and failed provider attempts without raw payloads', async () => {
    const run = await createRunWithDocuments()
    const job = await repository.getOrCreateDocumentFilterJob(run.id, configuration)
    const completed = await repository.startAiCall({ aiJobId: job.id, phase: 'TITLE', batchKey: 'all', attemptNo: 1, inputHash: 'b'.repeat(64) })
    await repository.completeAiCall(completed.id, { providerRequestId: 'provider-1', inputTokens: 20, outputTokens: 5, latencyMs: 120 })
    const failed = await repository.startAiCall({ aiJobId: job.id, phase: 'CONTENT', batchKey: 'batch-1', attemptNo: 1, inputHash: 'c'.repeat(64) })
    await repository.failAiCall(failed.id, { category: 'RATE_LIMITED', providerStatus: 429, message: 'Gemini geçici olarak yoğun.' })

    expect(await prisma.aiCall.findMany({ orderBy: { createdAt: 'asc' }, select: { status: true, providerRequestId: true, errorCategory: true } })).toEqual([
      { status: 'COMPLETED', providerRequestId: 'provider-1', errorCategory: null },
      { status: 'FAILED', providerRequestId: null, errorCategory: 'RATE_LIMITED' },
    ])
  })
})
