import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaAssistantKnowledge } from '../../src/modules/chat/infrastructure/prisma-assistant-knowledge'
import { runChatTool } from '../../src/modules/chat/application/chat-tools'
import { PrismaTopicAnalysisRepository } from '../../src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'

const prisma = new PrismaClient()
const topicRepository = new PrismaTopicAnalysisRepository(prisma)

const objects = new Map<string, Buffer>()
const objectStore = {
  async getContent(key: string) {
    const value = objects.get(key)
    if (!value) throw new Error(`Missing ${key}`)
    return value
  },
}
const knowledge = new PrismaAssistantKnowledge(prisma, objectStore)

function spec(topicId: string) {
  return {
    schemaVersion: 1, templateFamily: 'bulten-v2', reportId: '110926-01', topicId, card: 'K1',
    documentTitle: 'İthalat Rejimi Kararında Değişiklik', issueNumber: '33370', displayDate: '11 Eylül 2026 Cuma',
    typeLabel: 'Değişiklik', title: 'İthalat Rejiminde Gözetim Uygulaması', documentNumber: '2026/12',
    summary: 'PET reçine ithalatında gözetim uygulaması başlatıldı.',
    affectedParties: ['İthalatçılar'], dates: ['1 Ekim 2026: Yürürlüğe girer.'], note: null,
    source: { label: 'T.C. Resmî Gazete', url: 'https://www.resmigazete.gov.tr/doc.htm' }, blocks: ['B1', 'B10'],
  }
}

async function seedPublishedReport() {
  const object = await prisma.storedObject.create({ data: { sha256: 'a'.repeat(64), bucket: 'test', objectKey: 'objects/doc.html', mediaType: 'text/html', byteSize: 40n } })
  objects.set('objects/doc.html', Buffer.from('<html><body><p>PET reçine ithalatında gözetim.</p></body></html>'))
  const run = await prisma.scanRun.create({
    data: {
      requestKey: crypto.randomUUID(), targetDate: new Date('2026-09-11T00:00:00.000Z'), status: 'COMPLETED',
      editions: { create: { publicationDate: new Date('2026-09-11T00:00:00.000Z'), type: 'MAIN', indexUrl: 'https://www.resmigazete.gov.tr/11.09.2026', discoveryOrder: 0, documents: { create: { title: 'İthalat Rejimi Kararında Değişiklik', sourceUrl: 'https://www.resmigazete.gov.tr/doc.htm', publicationOrder: 0, storedObjectId: object.id } } } },
    },
    include: { editions: { include: { documents: true } } },
  })
  const document = run.editions[0]!.documents[0]!
  const job = await prisma.aiJob.create({ data: { scanRunId: run.id, kind: 'DOCUMENT_FILTER', status: 'COMPLETED', model: 'm', titlePromptVersion: 'v1', contentPromptVersion: 'v1', configurationHash: 'c'.repeat(64) } })
  await prisma.documentFilterDecision.create({ data: { aiJobId: job.id, documentId: document.id, titleDecision: 'IN', titleReason: 'Gümrükle ilgili', titleConfidence: 1, finalDecision: 'IN' } })
  const topic = (await topicRepository.ensureTopics(run.id))[0]!
  const analysis = await topicRepository.createAnalysisRevision({
    topicId: topic.id, version: 1, status: 'PASS', analysisObjectKey: 'analysis.json', markdownObjectKey: 'analysis.md',
    model: 'm', promptVersion: 'v1', schemaVersion: 1, inputTokens: 1, outputTokens: 1,
  })
  objects.set('analysis.md', Buffer.from('# Analiz\nPET reçine gözetimi.'))
  objects.set('report-r01.json', Buffer.from(JSON.stringify(spec(topic.id))))
  await topicRepository.createReportRevision({
    scanRunId: run.id, topicId: topic.id, analysisRevisionId: analysis.id, title: 'İthalat Rejimi Kararında Değişiklik',
    basename: `01-${topic.id}.html`, card: 'K1', version: 1, specObjectKey: 'report-r01.json', htmlObjectKey: 'report-r01.html',
  })
  return { runId: run.id, topicId: topic.id, documentId: document.id }
}

describe('PrismaAssistantKnowledge', () => {
  beforeEach(async () => {
    objects.clear()
    await prisma.scanRun.deleteMany()
    await prisma.storedObject.deleteMany()
    await prisma.customerGroup.deleteMany()
  })
  afterAll(() => prisma.$disconnect())

  it('finds a published bulletin by words that appear only inside it', async () => {
    const { topicId } = await seedPublishedReport()

    const reports = await knowledge.searchReports({ query: 'gözetim' })

    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      topicId, title: 'İthalat Rejiminde Gözetim Uygulaması', issueNumber: '33370', reportUrl: `/reports/${topicId}?revision=1`,
    })
  })

  it('returns the bulletin as readable text, not as a spec the model has to decode', async () => {
    const { topicId } = await seedPublishedReport()

    const report = await knowledge.getReport({ topicId })

    expect(report?.content).toContain('Özet: PET reçine ithalatında gözetim uygulaması başlatıldı.')
    expect(report?.content).toContain('- İthalatçılar')
    expect(report?.content).toContain('Kaynak: T.C. Resmî Gazete')
  })

  it('reads the analysis and the archived document text', async () => {
    const { topicId, documentId } = await seedPublishedReport()

    expect((await knowledge.getAnalysis({ topicId }))?.markdown).toContain('PET reçine gözetimi.')
    expect((await knowledge.getDocumentText({ documentId }))?.text).toContain('PET reçine ithalatında gözetim.')
  })

  it('lists documents with their filter decision and scan runs with their counts', async () => {
    await seedPublishedReport()

    const documents = await knowledge.searchDocuments({ from: '2026-09-11', to: '2026-09-11' })
    expect(documents[0]).toMatchObject({ filterDecision: 'IN', hasTopic: true, publicationDate: '2026-09-11' })

    const runs = await knowledge.listScanRuns({ date: '2026-09-11' })
    expect(runs[0]).toMatchObject({ status: 'COMPLETED', documents: 1, relevantDocuments: 1, reports: 1 })
  })

  it('answers a tool call the way the model would make it', async () => {
    const { topicId } = await seedPublishedReport()

    const result = await runChatTool('raporlari_ara', { sorgu: 'PET reçine', limit: 5 }, knowledge) as { raporlar: unknown[] }

    expect(result.raporlar).toHaveLength(1)
    expect(await runChatTool('rapor_getir', { topicId }, knowledge)).toMatchObject({ topicId, version: 1 })
  })

  it('reports how many recipients a group has without reciting their addresses', async () => {
    await prisma.customerGroup.create({ data: { name: 'Tekstil', emails: ['a@example.com', 'b@example.com'] } })

    const groups = await knowledge.listCustomerGroups()

    expect(groups).toEqual([{ name: 'Tekstil', description: null, recipients: 2, isActive: true }])
    expect(JSON.stringify(groups)).not.toContain('@example.com')
  })

  it('refuses a tool the model invented', async () => {
    await expect(runChatTool('veritabanini_sil', {}, knowledge)).rejects.toThrow(/Tanımsız araç/)
  })
})
