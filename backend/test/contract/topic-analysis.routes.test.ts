import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'
import { PrismaTopicAnalysisRepository } from '../../src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'

const prisma = new PrismaClient()
const scanRepository = new PrismaScanRepository(prisma)
const topicRepository = new PrismaTopicAnalysisRepository(prisma)

async function seedTopic() {
  const run = await prisma.scanRun.create({
    data: {
      requestKey: crypto.randomUUID(), targetDate: new Date('2026-09-11T00:00:00.000Z'), indexSourceUrl: 'https://www.resmigazete.gov.tr/11.09.2026', indexObjectKey: 'index.html', indexSha256: 'a'.repeat(64),
      editions: { create: { publicationDate: new Date('2026-09-11T00:00:00.000Z'), type: 'MAIN', indexUrl: 'https://www.resmigazete.gov.tr/11.09.2026', discoveryOrder: 0, documents: { create: { title: 'İthalat Tebliği', sourceUrl: 'https://www.resmigazete.gov.tr/doc.htm', publicationOrder: 0 } } } },
    }, include: { editions: { include: { documents: true } } },
  })
  const document = run.editions[0]!.documents[0]!
  const job = await prisma.aiJob.create({ data: { scanRunId: run.id, kind: 'DOCUMENT_FILTER', status: 'COMPLETED', model: 'gemini-3.7-flash', titlePromptVersion: 'v1', contentPromptVersion: 'v1', configurationHash: 'b'.repeat(64) } })
  await prisma.documentFilterDecision.create({ data: { aiJobId: job.id, documentId: document.id, titleDecision: 'IN', titleReason: 'İlgili', titleConfidence: 0.99, finalDecision: 'IN' } })
  const topic = (await topicRepository.ensureTopics(run.id))[0]!
  const analysis = await topicRepository.createAnalysisRevision({ topicId: topic.id, version: 1, status: 'PASS', analysisObjectKey: 'runs/analysis.json', markdownObjectKey: 'runs/analysis.md', model: 'gemini-3.7-flash', promptVersion: 'topic-analysis-v1', schemaVersion: 1, inputTokens: 10, outputTokens: 5 })
  await topicRepository.createReportRevision({ scanRunId: run.id, topicId: topic.id, analysisRevisionId: analysis.id, title: 'İthalat Tebliği', basename: `01-${topic.id}.html`, card: 'K1', version: 1, specObjectKey: 'runs/report-spec.json', htmlObjectKey: 'runs/report.html' })
  return { runId: run.id, topicId: topic.id }
}

describe('topic analysis HTTP contract', () => {
  beforeEach(async () => { await prisma.scanRun.deleteMany() })
  afterAll(() => prisma.$disconnect())

  it('returns immutable analysis and report revisions', async () => {
    const { topicId } = await seedTopic()
    const app = await buildApp({ scanRepository, topicRepository })
    const response = await app.inject({ method: 'GET', url: `/api/v1/topics/${topicId}` })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id: topicId, thread: { messages: [] }, latestAnalysis: { version: 1 }, latestReport: { version: 1, card: 'K1' } })
    expect(JSON.stringify(response.json())).not.toMatch(/confidence/i)
    await app.close()
  })

  it('appends a revision request idempotently', async () => {
    const { topicId } = await seedTopic()
    const app = await buildApp({ scanRepository, topicRepository })
    const requestKey = crypto.randomUUID()
    const request = () => app.inject({ method: 'POST', url: `/api/v1/topics/${topicId}/messages`, headers: { 'idempotency-key': requestKey }, payload: { message: 'Etkilenen ithalatçıları daha açık anlat.' } })
    const first = await request()
    const second = await request()
    expect(first.statusCode).toBe(202)
    expect(second.json()).toEqual(first.json())
    expect(await prisma.chatMessage.count({ where: { requestKey } })).toBe(1)
    expect(await prisma.topicOutbox.count({ where: { topicId } })).toBe(1)
    await app.close()
  })

  it('lists the run topics and queues retry only while awaiting retry', async () => {
    const { runId, topicId } = await seedTopic()
    await prisma.topicProcess.update({ where: { id: topicId }, data: { status: 'AWAITING_RETRY', lastErrorCategory: 'RATE_LIMITED', lastErrorMessage: 'Gemini geçici olarak yoğun.' } })
    const app = await buildApp({ scanRepository, topicRepository })
    const list = await app.inject({ method: 'GET', url: `/api/v1/scan-runs/${runId}/topics` })
    const retry = await app.inject({ method: 'POST', url: `/api/v1/topics/${topicId}/retry`, headers: { 'idempotency-key': crypto.randomUUID() } })
    expect(list.json()).toMatchObject({ topics: [{ id: topicId, retryAvailable: true, errorMessage: 'Gemini geçici olarak yoğun.' }] })
    expect(retry.statusCode).toBe(202)
    await app.close()
  })
})
