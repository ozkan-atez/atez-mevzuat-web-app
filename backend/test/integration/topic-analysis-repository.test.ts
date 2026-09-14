import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaTopicAnalysisRepository } from '../../src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'

const prisma = new PrismaClient()
const repository = new PrismaTopicAnalysisRepository(prisma)

describe('topic analysis repository', () => {
  beforeEach(async () => {
    await prisma.scanRun.deleteMany()
  })

  afterAll(() => prisma.$disconnect())

  it('creates exactly one topic per final IN document and preserves analysis revisions', async () => {
    const run = await prisma.scanRun.create({
      data: {
        requestKey: crypto.randomUUID(),
        targetDate: new Date('2026-09-11T00:00:00.000Z'),
        editions: {
          create: {
            publicationDate: new Date('2026-09-11T00:00:00.000Z'),
            type: 'MAIN',
            indexUrl: 'https://www.resmigazete.gov.tr/eskiler/2026/09/20260911.htm',
            discoveryOrder: 0,
            documents: {
              create: [
                { title: 'İlgili Tebliğ', sourceUrl: 'https://www.resmigazete.gov.tr/eskiler/2026/09/20260911-1.htm', publicationOrder: 0 },
                { title: 'İlgisiz Karar', sourceUrl: 'https://www.resmigazete.gov.tr/eskiler/2026/09/20260911-2.htm', publicationOrder: 1 },
              ],
            },
          },
        },
      },
      include: { editions: { include: { documents: true } } },
    })
    const edition = run.editions[0]
    if (!edition) throw new Error('Fixture edition was not created')
    const [included, excluded] = edition.documents
    if (!included || !excluded) throw new Error('Fixture documents were not created')
    const filterJob = await prisma.aiJob.create({
      data: {
        scanRunId: run.id,
        kind: 'DOCUMENT_FILTER',
        status: 'COMPLETED',
        model: 'gemini-3.7-flash',
        titlePromptVersion: 'title-v1',
        contentPromptVersion: 'content-v1',
        configurationHash: 'a'.repeat(64),
      },
    })
    await prisma.documentFilterDecision.createMany({
      data: [
        { aiJobId: filterJob.id, documentId: included.id, titleDecision: 'IN', titleReason: 'İlgili', titleConfidence: 0.99, finalDecision: 'IN' },
        { aiJobId: filterJob.id, documentId: excluded.id, titleDecision: 'OUT', titleReason: 'İlgisiz', titleConfidence: 0.99, finalDecision: 'OUT' },
      ],
    })

    const topics = await repository.ensureTopics(run.id)
    expect(topics).toHaveLength(1)
    const topic = topics[0]
    if (!topic) throw new Error('IN topic was not created')
    expect(topic.documentId).toBe(included.id)
    expect(await repository.ensureTopics(run.id)).toEqual(topics)

    const first = await repository.createAnalysisRevision({
      topicId: topic.id,
      version: 1,
      status: 'PASS',
      analysisObjectKey: `runs/2026/09/11/${run.id}/topics/${topic.id}/analysis/r01/analysis.json`,
      markdownObjectKey: `runs/2026/09/11/${run.id}/topics/${topic.id}/analysis/r01/analysis.md`,
      model: 'gemini-3.7-flash',
      promptVersion: 'topic-analysis-v1',
      schemaVersion: 1,
      inputTokens: 120,
      outputTokens: 80,
    })
    const second = await repository.createAnalysisRevision({
      topicId: topic.id,
      version: 2,
      status: 'PASS',
      analysisObjectKey: `runs/2026/09/11/${run.id}/topics/${topic.id}/analysis/r02/analysis.json`,
      markdownObjectKey: `runs/2026/09/11/${run.id}/topics/${topic.id}/analysis/r02/analysis.md`,
      model: 'gemini-3.7-flash',
      promptVersion: 'topic-analysis-v1',
      schemaVersion: 1,
      inputTokens: 60,
      outputTokens: 40,
    })

    expect(first.version).toBe(1)
    expect(second.version).toBe(2)
    expect(await prisma.analysisRevision.count({ where: { topicId: topic.id } })).toBe(2)
    const storedTopic = await repository.getTopic(topic.id)
    expect(storedTopic?.thread?.topicId).toBe(topic.id)
  })

  it('leases a topic command to only one concurrent dispatcher', async () => {
    const run = await prisma.scanRun.create({ data: { requestKey: crypto.randomUUID(), targetDate: new Date('2026-09-11T00:00:00.000Z') } })
    const edition = await prisma.gazetteEdition.create({ data: { scanRunId: run.id, publicationDate: run.targetDate, type: 'MAIN', indexUrl: 'https://example.test/index', discoveryOrder: 0 } })
    const document = await prisma.collectedDocument.create({ data: { editionId: edition.id, title: 'İthalat Tebliği', sourceUrl: 'https://example.test/doc', publicationOrder: 0 } })
    const topic = await prisma.topicProcess.create({ data: { scanRunId: run.id, documentId: document.id, thread: { create: {} } } })
    await prisma.topicOutbox.create({ data: { topicId: topic.id, command: 'RETRY_ANALYSIS', requestKey: crypto.randomUUID() } })
    const [first, second] = await Promise.all([repository.claimPendingTopicOutbox(10), repository.claimPendingTopicOutbox(10)])
    expect([...first, ...second].filter((row) => row.topicId === topic.id)).toHaveLength(1)
  })
})
