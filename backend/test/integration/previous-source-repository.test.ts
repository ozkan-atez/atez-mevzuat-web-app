import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'

const prisma = new PrismaClient()
const repository = new PrismaScanRepository(prisma)

describe('previous source repository', () => {
  beforeEach(() => prisma.scanRun.deleteMany())
  afterAll(() => prisma.$disconnect())

  it('creates one resumable job for each final IN document only', async () => {
    const run = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-09-14' })
    await repository.saveEditions(run.id, run.targetDate, [{
      type: 'MAIN', supplementNo: null, indexUrl: 'https://www.resmigazete.gov.tr/14.09.2026', discoveryOrder: 0,
      documents: [
        { title: 'Ilgili teblig', sourceUrl: 'https://www.resmigazete.gov.tr/in.htm', publicationOrder: 1 },
        { title: 'Ilgisiz ilan', sourceUrl: 'https://www.resmigazete.gov.tr/out.htm', publicationOrder: 2 },
      ],
    }])
    const filterJob = await repository.getOrCreateDocumentFilterJob(run.id, {
      model: 'gemini-3.7-flash', titlePromptVersion: 'title-v1', contentPromptVersion: 'content-v1', configurationHash: 'a'.repeat(64),
    })
    const documents = await repository.listFilterDocuments(run.id)
    await repository.markFilterRunning(run.id, filterJob.id, documents.length)
    await repository.saveTitleDecisions(filterJob.id, [
      { documentId: documents[0]!.id, decision: 'IN', reason: 'Ilgili.', confidence: 0.9 },
      { documentId: documents[1]!.id, decision: 'OUT', reason: 'Ilgisiz.', confidence: 0.9 },
    ])

    const first = await repository.ensurePreviousSourceJobs(run.id, {
      model: 'gemini-3.7-flash', promptVersion: 'previous-source-preflight-v1', configurationHash: 'b'.repeat(64),
    })
    const second = await repository.ensurePreviousSourceJobs(run.id, {
      model: 'gemini-3.7-flash', promptVersion: 'previous-source-preflight-v1', configurationHash: 'b'.repeat(64),
    })

    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ documentId: documents[0]!.id, status: 'QUEUED' })
    expect(second).toEqual(first)
    expect(await prisma.previousSourceJob.count()).toBe(1)
  })
})
