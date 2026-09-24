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
    await prisma.managedSource.deleteMany()
  })
  afterAll(() => prisma.$disconnect())

  it('finds only active chat sources and returns their stored text', async () => {
    const source = await prisma.managedSource.create({ data: {
      url: 'https://example.org/customs', title: 'Gümrük rehberi', description: 'İthalat işlemleri',
      contentText: 'PET reçine ithalatına ilişkin açıklama.', contentType: 'text/html', fetchedAt: new Date(),
    } })
    await prisma.managedSource.create({ data: {
      url: 'https://example.org/hidden', title: 'Gizli rehber', contentText: 'PET reçine', useInChat: false,
    } })
    const found = await runChatTool('eklenen_kaynaklari_ara', { sorgu: 'PET reçine' }, knowledge) as { kaynaklar: Array<{ id: string }> }
    expect(found.kaynaklar.map((item) => item.id)).toEqual([source.id])
    expect(await runChatTool('eklenen_kaynagi_getir', { kaynakId: source.id }, knowledge)).toMatchObject({ url: source.url, text: 'PET reçine ithalatına ilişkin açıklama.' })
  })

  it('passes only matching enabled sources to a run topic', async () => {
    const { topicId } = await seedPublishedReport()
    await prisma.managedSource.createMany({ data: [
      { url: 'https://example.org/one', title: 'İthalat rehberi', keywords: 'ithalat', contentText: 'İthalat açıklaması', useInRuns: true },
      { url: 'https://example.org/two', title: 'İhracat rehberi', keywords: 'ihracat', contentText: 'İhracat açıklaması', useInRuns: true },
      { url: 'https://example.org/three', title: 'Kapalı rehber', keywords: 'ithalat', contentText: 'Kapalı açıklama', useInRuns: false },
    ] })
    const input = await topicRepository.getTopicEvidenceInput(topicId)
    expect(input?.managedSources?.map((source) => source.title)).toEqual(['İthalat rehberi'])
  })

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

  it('lists every run on a date, including a no-change report, and exposes versioned downloads', async () => {
    const { runId, topicId } = await seedPublishedReport()
    const other = await prisma.scanRun.create({ data: { requestKey: crypto.randomUUID(), targetDate: new Date('2026-09-11T00:00:00.000Z'), status: 'COMPLETED' } })
    const noChange = await prisma.topicReport.create({
      data: { scanRunId: other.id, title: 'Değişiklik Yok', basename: '00-degisiklik-yok.html', card: 'K6', latestVersion: 1,
        revisions: { create: { version: 1, status: 'VALIDATED', card: 'K6', specObjectKey: 'no-change.json', htmlObjectKey: 'no-change.html' } } },
    })
    objects.set('no-change.json', Buffer.from(JSON.stringify({
      schemaVersion: 1, templateFamily: 'bulten-v2', reportId: '110926-00', topicId: null, card: 'K6',
      documentTitle: 'Günlük bülten', issueNumber: '33370', displayDate: '11 Eylül 2026', emptyDayText: 'Kapsam içi değişiklik yok.',
      source: { label: 'T.C. Resmî Gazete', url: 'https://www.resmigazete.gov.tr/' }, blocks: ['B1'],
    })))

    await prisma.topicReport.update({ where: { id: noChange.id }, data: {
      reviewStatus: 'PENDING_APPROVAL', pendingBaseVersion: 1,
      pendingSpecJson: { schemaVersion: 1, templateFamily: 'bulten-v2', reportId: '110926-00', topicId: null, card: 'K6',
        documentTitle: 'Günlük bülten', issueNumber: '33370', displayDate: '11 Eylül 2026', emptyDayText: 'Onay bekleyen düzeltme.',
        source: { label: 'T.C. Resmî Gazete', url: 'https://www.resmigazete.gov.tr/' }, blocks: ['B1'] },
    } })

    const daily = await knowledge.dailyReports({ date: '2026-09-11' })
    expect(daily.map((item) => item.runId)).toEqual([other.id, runId])
    expect(daily[0]?.reports[0]).toMatchObject({ reportId: noChange.id, topicId: null, reportUrl: `/runs/${other.id}/reports/${noChange.id}` })
    const published = await knowledge.getReport({ reportId: noChange.id })
    expect(published?.content).toContain('Kapsam içi değişiklik yok.')
    expect(published?.content).not.toContain('Onay bekleyen düzeltme.')
    expect(published?.pendingDraft?.content).toContain('Onay bekleyen düzeltme.')
    expect(await knowledge.reportFiles({ reportId: noChange.id, version: 1 })).toMatchObject({
      pdfUrl: `/api/v1/scan-runs/${other.id}/reports/${noChange.id}/pdf?version=1`,
      htmlUrl: `/api/v1/scan-runs/${other.id}/reports/${noChange.id}/html?version=1&download=1`,
    })
    expect((await knowledge.reportFiles({ topicId, version: 1 }))?.pdfUrl).toBe(`/api/v1/topics/${topicId}/reports/1/pdf`)
    expect((await runChatTool('gunluk_raporlari_getir', { tarih: '2026-09-11' }, knowledge) as { taramalar: unknown[] }).taramalar).toHaveLength(2)
  })

  it('keeps pending edits separate from published report and exposes the revision trail', async () => {
    const { topicId, documentId } = await seedPublishedReport()
    const original = spec(topicId)
    const report = await prisma.topicReport.findUniqueOrThrow({ where: { topicId } })
    const draft = await prisma.reportDraft.create({ data: {
      topicId, baseVersion: 1, specJson: { ...original, summary: 'Bekleyen yeni özet' },
      edits: { create: [{ sequence: 1, path: 'summary', previousValue: 'Eski özet', nextValue: 'Bekleyen yeni özet', source: 'USER' }] },
    } })
    const view = await knowledge.getReport({ reportId: report.id })
    expect(view?.content).toContain('PET reçine ithalatında gözetim')
    expect(view?.content).not.toContain('Bekleyen yeni özet')
    expect(view?.pendingDraft).toMatchObject({ baseVersion: 1, changes: 1 })
    expect((await knowledge.draftChanges({ reportId: report.id }))?.changes).toMatchObject([{ path: 'summary', reverted: false }])
    const edit = await prisma.reportFieldEdit.findFirstOrThrow({ where: { draftId: draft.id } })
    await prisma.reportFieldEdit.create({ data: { draftId: draft.id, sequence: 2, path: 'summary', previousValue: 'Bekleyen yeni özet', nextValue: 'Eski özet', source: 'USER', revertsEditId: edit.id } })
    expect((await knowledge.draftChanges({ reportId: report.id }))?.changes[0]).toMatchObject({ reverted: true })
    expect((await knowledge.revisionHistory({ topicId }))?.reportRevisions).toMatchObject([{ version: 1, status: 'VALIDATED' }])
    expect((await knowledge.documentConnections({ documentId }))?.reports).toMatchObject([{ reportId: report.id, version: 1 }])
    await prisma.reportDraft.delete({ where: { id: draft.id } })
  })

  it('reads the analysis and the archived document text', async () => {
    const { topicId, documentId } = await seedPublishedReport()

    expect((await knowledge.getAnalysis({ topicId }))?.markdown).toContain('PET reçine gözetimi.')
    expect((await knowledge.getDocumentText({ documentId }))?.text).toContain('PET reçine ithalatında gözetim.')
  })

  it('lists documents with their filter decision and scan runs with their counts', async () => {
    const { runId } = await seedPublishedReport()

    const documents = await knowledge.searchDocuments({ from: '2026-09-11', to: '2026-09-11' })
    expect(documents[0]).toMatchObject({ filterDecision: 'IN', hasTopic: true, publicationDate: '2026-09-11' })

    const runs = await knowledge.listScanRuns({ date: '2026-09-11' })
    expect(runs[0]).toMatchObject({ status: 'COMPLETED', documents: 1, relevantDocuments: 1, reports: 1 })
    await prisma.stageExecution.create({ data: { scanRunId: runId, stage: 'DOWNLOADING_DOCUMENTS', status: 'AWAITING_RETRY', errorSummary: 'Kaynak erişilemedi' } })
    await prisma.fetchAttempt.create({ data: { scanRunId: runId, sourceUrl: 'https://www.resmigazete.gov.tr/doc.htm', attemptNo: 1, status: 'FAILED', errorMessage: 'Zaman aşımı' } })
    expect(await knowledge.scanStages({ runId })).toMatchObject({
      stages: [{ stage: 'DOWNLOADING_DOCUMENTS', error: 'Kaynak erişilemedi' }],
      failedFetches: [{ error: 'Zaman aşımı' }],
    })
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
