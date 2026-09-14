import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { AiModelClient } from '../../src/modules/ai/application/ai-model-client'
import { executeTopicRevision } from '../../src/modules/topic-analysis/application/execute-topic-revision'
import type { TopicObjectStore } from '../../src/modules/topic-analysis/application/ports'
import type { AnalysisResult } from '../../src/modules/topic-analysis/domain/analysis-schemas'
import { PrismaTopicAnalysisRepository } from '../../src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'

const prisma = new PrismaClient()
const repository = new PrismaTopicAnalysisRepository(prisma)

class MemoryStore implements TopicObjectStore {
  values = new Map<string, Buffer>()
  async getContent(key: string) { const value = this.values.get(key); if (!value) throw new Error(`Missing ${key}`); return value }
  async putRunFile(key: string, body: Buffer, mediaType: string) { this.values.set(key, body); return { objectKey: key, sha256: 'f'.repeat(64), mediaType, byteSize: BigInt(body.length) } }
}

function analysis(topicId: string, summary = 'İthalat kuralı değişti.'): AnalysisResult {
  return {
    schemaVersion: 1, topicId, status: 'PASS',
    document: { title: 'İthalat Tebliği', gazetteDate: '2026-09-11', gazetteNumber: '33000', sourceUrl: 'https://www.resmigazete.gov.tr/current' },
    change: { type: 'AMENDMENT', detailedAnalysis: summary, summary }, affectedParties: [], effectiveDates: [], comparisons: [], tables: [],
    officialSources: [{ id: 's1', label: 'T.C. Resmî Gazete', url: 'https://www.resmigazete.gov.tr/current', evidenceIds: ['e1'] }], supportingSources: [],
    evidence: [{ id: 'e1', objectKey: 'objects/current.html', locator: 'paragraph:1' }], unresolvedReferences: [], emailTitle: 'İthalat değişikliği', emailSummary: summary,
  }
}

describe('executeTopicRevision', () => {
  beforeEach(() => prisma.scanRun.deleteMany())
  afterAll(() => prisma.$disconnect())

  it('creates a new immutable analysis and report revision in the same topic thread', async () => {
    const object = await prisma.storedObject.create({ data: { sha256: 'a'.repeat(64), bucket: 'test', objectKey: 'objects/current.html', mediaType: 'text/html', byteSize: 20n } })
    const run = await prisma.scanRun.create({ data: {
      requestKey: crypto.randomUUID(), targetDate: new Date('2026-09-11T00:00:00.000Z'), indexSourceUrl: 'https://www.resmigazete.gov.tr/11.09.2026', indexObjectKey: 'index.html', indexSha256: 'b'.repeat(64),
      editions: { create: { publicationDate: new Date('2026-09-11T00:00:00.000Z'), type: 'MAIN', indexUrl: 'https://www.resmigazete.gov.tr/11.09.2026', discoveryOrder: 0, documents: { create: { title: 'İthalat Tebliği', sourceUrl: 'https://www.resmigazete.gov.tr/current', publicationOrder: 0, storedObjectId: object.id } } } },
    }, include: { editions: { include: { documents: true } } } })
    const document = run.editions[0]!.documents[0]!
    const filter = await prisma.aiJob.create({ data: { scanRunId: run.id, kind: 'DOCUMENT_FILTER', status: 'COMPLETED', model: 'gemini-3.7-flash', titlePromptVersion: 'v1', contentPromptVersion: 'v1', configurationHash: 'c'.repeat(64) } })
    await prisma.documentFilterDecision.create({ data: { aiJobId: filter.id, documentId: document.id, titleDecision: 'IN', titleReason: 'İlgili', titleConfidence: 1, finalDecision: 'IN' } })
    const topic = (await repository.ensureTopics(run.id))[0]!
    const initial = analysis(topic.id)
    await repository.createAnalysisRevision({ topicId: topic.id, version: 1, status: 'PASS', analysisObjectKey: 'analysis-r1.json', markdownObjectKey: 'analysis-r1.md', model: 'gemini-3.7-flash', promptVersion: 'topic-analysis-v1', schemaVersion: 1, inputTokens: 10, outputTokens: 5 })
    const request = await repository.appendRevisionRequest({ topicId: topic.id, requestKey: crypto.randomUUID(), message: 'Etkilenen ithalatçıları daha açık analiz et.', revisionKind: 'ANALYSIS' })
    const store = new MemoryStore()
    store.values.set('objects/current.html', Buffer.from('<p>İthalatçılar yeni kurala tabidir.</p>'))
    store.values.set('analysis-r1.json', Buffer.from(JSON.stringify(initial)))
    store.values.set('analysis-r1.md', Buffer.from('# İlk analiz'))
    const revised = { ...analysis(topic.id, 'İthalatçıların beyan süreçleri değişti.'), affectedParties: [{ name: 'İthalatçılar', impact: 'Beyan süreçleri değişir.', evidenceIds: ['e1'] }] }
    const ai: AiModelClient = { async generateStructured() { return { json: revised, providerRequestId: 'revision-response', usage: { inputTokens: 40, outputTokens: 20 } } } }

    await executeTopicRevision({ topicId: topic.id, messageId: request.messageId }, { repository, objectStore: store, aiModel: ai, model: 'gemini-3.7-flash', maxContextBytes: 1_000_000 })

    expect(await prisma.analysisRevision.count({ where: { topicId: topic.id } })).toBe(2)
    expect(await prisma.reportRevision.count({ where: { report: { topicId: topic.id } } })).toBe(1)
    expect((await repository.getTopicDetail(topic.id))?.thread.messages.at(-1)).toMatchObject({ role: 'ASSISTANT', kind: 'REVISION_RESULT' })
  })
})
