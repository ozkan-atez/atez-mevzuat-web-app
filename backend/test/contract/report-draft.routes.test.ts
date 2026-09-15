import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'
import { PrismaTopicAnalysisRepository } from '../../src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'
import { PrismaReportDraftRepository } from '../../src/modules/topic-analysis/infrastructure/prisma-report-draft-repository'

const prisma = new PrismaClient()
const scanRepository = new PrismaScanRepository(prisma)
const topicRepository = new PrismaTopicAnalysisRepository(prisma)
const draftRepository = new PrismaReportDraftRepository(prisma)

const publishedSpec = {
  schemaVersion: 1,
  templateFamily: 'bulten-v2',
  reportId: '110926-01',
  topicId: '00000000-0000-4000-8000-000000000000',
  card: 'K1',
  documentTitle: 'İthalat Tebliği',
  issueNumber: '33367',
  displayDate: '11 Eylül 2026 Cuma',
  typeLabel: 'Değişiklik',
  title: 'İthalat Tebliğinde Değişiklik',
  summary: 'Özet metni.',
  affectedParties: ['İthalatçılar'],
  dates: ['11 Eylül 2026: Yürürlüğe girer.'],
  note: null,
  source: { label: 'T.C. Resmî Gazete', url: 'https://www.resmigazete.gov.tr/doc.htm' },
  blocks: ['B1', 'B10'],
}

const written = new Map<string, Buffer>()

function objectStore(topicId: string) {
  return {
    getContent: async (key: string) => {
      if (written.has(key)) return written.get(key) as Buffer
      return Buffer.from(JSON.stringify({ ...publishedSpec, topicId }))
    },
    putRunFile: async (key: string, body: Buffer, mediaType: string) => {
      written.set(key, body)
      return { objectKey: key, sha256: 'a'.repeat(64), mediaType, byteSize: BigInt(body.byteLength) }
    },
  }
}

async function seedPublishedReport() {
  const run = await prisma.scanRun.create({
    data: {
      requestKey: crypto.randomUUID(), targetDate: new Date('2026-09-11T00:00:00.000Z'),
      editions: {
        create: {
          publicationDate: new Date('2026-09-11T00:00:00.000Z'), type: 'MAIN',
          indexUrl: 'https://www.resmigazete.gov.tr/11.09.2026', discoveryOrder: 0,
          documents: { create: { title: 'İthalat Tebliği', sourceUrl: 'https://www.resmigazete.gov.tr/doc.htm', publicationOrder: 0 } },
        },
      },
    },
    include: { editions: { include: { documents: true } } },
  })
  const document = run.editions[0]!.documents[0]!
  const job = await prisma.aiJob.create({ data: { scanRunId: run.id, kind: 'DOCUMENT_FILTER', status: 'COMPLETED', model: 'm', titlePromptVersion: 'v1', contentPromptVersion: 'v1', configurationHash: 'b'.repeat(64) } })
  await prisma.documentFilterDecision.create({ data: { aiJobId: job.id, documentId: document.id, titleDecision: 'IN', titleReason: 'İlgili', titleConfidence: 0.9, finalDecision: 'IN' } })
  const topic = (await topicRepository.ensureTopics(run.id))[0]!
  const analysis = await topicRepository.createAnalysisRevision({ topicId: topic.id, version: 1, status: 'PASS', analysisObjectKey: 'a.json', markdownObjectKey: 'a.md', model: 'm', promptVersion: 'v1', schemaVersion: 1, inputTokens: 1, outputTokens: 1 })
  await topicRepository.createReportRevision({
    scanRunId: run.id, topicId: topic.id, analysisRevisionId: analysis.id, title: 'İthalat Tebliği',
    basename: `01-${topic.id}.html`, card: 'K1', version: 1, specObjectKey: 'r01/report-spec.json', htmlObjectKey: 'r01/report.html',
  })
  return { topicId: topic.id, analysisRevisionId: analysis.id }
}

const appFor = (topicId: string) => buildApp({ scanRepository, topicRepository, draftRepository, objectStore: objectStore(topicId) })

describe('report draft HTTP contract', () => {
  beforeEach(async () => { await prisma.scanRun.deleteMany(); written.clear() })
  afterAll(() => prisma.$disconnect())

  it('opens a draft on first edit and returns the re-rendered preview', async () => {
    const { topicId } = await seedPublishedReport()
    const app = await appFor(topicId)

    const response = await app.inject({
      method: 'POST', url: `/api/v1/topics/${topicId}/draft/edits`,
      headers: { 'idempotency-key': crypto.randomUUID() },
      payload: { edits: [{ path: 'title', value: 'Düzeltilmiş Başlık' }], expectedVersion: 1 },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().draft).toMatchObject({ baseVersion: 1, status: 'OPEN' })
    expect(response.json().draft.edits).toHaveLength(1)
    expect(response.json().spec.title).toBe('Düzeltilmiş Başlık')
    expect(response.json().html).toContain('Düzeltilmiş Başlık')
    await app.close()
  })

  it('rejects a locked field and leaves the draft untouched', async () => {
    const { topicId } = await seedPublishedReport()
    const app = await appFor(topicId)

    const response = await app.inject({
      method: 'POST', url: `/api/v1/topics/${topicId}/draft/edits`,
      headers: { 'idempotency-key': crypto.randomUUID() },
      payload: { edits: [{ path: 'issueNumber', value: '99999' }] },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ reason: 'LOCKED_PATH', path: 'issueNumber' })
    await app.close()
  })

  it('does not apply the same idempotency key twice', async () => {
    const { topicId } = await seedPublishedReport()
    const app = await appFor(topicId)
    const key = crypto.randomUUID()
    const payload = { edits: [{ path: 'summary', value: 'Yeni özet.' }] }

    await app.inject({ method: 'POST', url: `/api/v1/topics/${topicId}/draft/edits`, headers: { 'idempotency-key': key }, payload })
    const second = await app.inject({ method: 'POST', url: `/api/v1/topics/${topicId}/draft/edits`, headers: { 'idempotency-key': key }, payload })

    expect(second.statusCode).toBe(200)
    expect(second.json().draft.edits).toHaveLength(1)
    await app.close()
  })

  it('publishes every accumulated edit as one new revision', async () => {
    const { topicId, analysisRevisionId } = await seedPublishedReport()
    const app = await appFor(topicId)
    for (const edit of [{ path: 'title', value: 'Yeni Başlık' }, { path: 'summary', value: 'Yeni özet.' }]) {
      await app.inject({ method: 'POST', url: `/api/v1/topics/${topicId}/draft/edits`, headers: { 'idempotency-key': crypto.randomUUID() }, payload: { edits: [edit] } })
    }

    const published = await app.inject({ method: 'POST', url: `/api/v1/topics/${topicId}/draft/publish`, payload: { expectedVersion: 1 } })

    expect(published.statusCode).toBe(201)
    expect(published.json()).toMatchObject({ version: 2, card: 'K1' })
    const revisions = await prisma.reportRevision.findMany({ where: { report: { topicId } }, orderBy: { version: 'asc' } })
    expect(revisions.map((revision) => revision.version)).toEqual([1, 2])
    // A field edit changes wording, not evidence: no new analysis revision.
    expect(revisions[1]?.analysisRevisionId).toBe(analysisRevisionId)
    expect(await prisma.analysisRevision.count({ where: { topicId } })).toBe(1)
    expect(await prisma.reportDraft.findFirst({ where: { topicId } })).toMatchObject({ status: 'PUBLISHED' })
    await app.close()
  })

  it('keeps the previous revision untouched after publishing', async () => {
    const { topicId } = await seedPublishedReport()
    const app = await appFor(topicId)
    await app.inject({ method: 'POST', url: `/api/v1/topics/${topicId}/draft/edits`, headers: { 'idempotency-key': crypto.randomUUID() }, payload: { edits: [{ path: 'title', value: 'Yeni Başlık' }] } })

    await app.inject({ method: 'POST', url: `/api/v1/topics/${topicId}/draft/publish`, payload: {} })

    const first = await prisma.reportRevision.findFirst({ where: { report: { topicId }, version: 1 } })
    expect(first?.specObjectKey).toBe('r01/report-spec.json')
    expect([...written.keys()].some((key) => key.includes('/r02/'))).toBe(true)
    expect([...written.keys()].some((key) => key.includes('/r01/'))).toBe(false)
    await app.close()
  })

  it('refuses to publish a draft whose base revision moved on', async () => {
    const { topicId } = await seedPublishedReport()
    const app = await appFor(topicId)
    await app.inject({ method: 'POST', url: `/api/v1/topics/${topicId}/draft/edits`, headers: { 'idempotency-key': crypto.randomUUID() }, payload: { edits: [{ path: 'title', value: 'Yeni Başlık' }] } })
    // Another revision lands while the draft is open.
    const analysis = await prisma.analysisRevision.findFirstOrThrow({ where: { topicId } })
    await topicRepository.createReportRevision({
      scanRunId: (await prisma.topicProcess.findUniqueOrThrow({ where: { id: topicId } })).scanRunId,
      topicId, analysisRevisionId: analysis.id, title: 'İthalat Tebliği', basename: `01-${topicId}.html`,
      card: 'K1', version: 2, specObjectKey: 'r02/report-spec.json', htmlObjectKey: 'r02/report.html',
    })

    const published = await app.inject({ method: 'POST', url: `/api/v1/topics/${topicId}/draft/publish`, payload: {} })

    expect(published.statusCode).toBe(409)
    expect(published.json()).toMatchObject({ currentVersion: 2 })
    await app.close()
  })

  it('reverts one edit by appending its inverse and keeps both in history', async () => {
    const { topicId } = await seedPublishedReport()
    const app = await appFor(topicId)
    const applied = await app.inject({ method: 'POST', url: `/api/v1/topics/${topicId}/draft/edits`, headers: { 'idempotency-key': crypto.randomUUID() }, payload: { edits: [{ path: 'title', value: 'Yeni Başlık' }] } })
    const editId = applied.json().draft.edits[0].id

    const reverted = await app.inject({ method: 'POST', url: `/api/v1/topics/${topicId}/draft/edits/${editId}/revert` })

    expect(reverted.statusCode).toBe(200)
    expect(reverted.json().spec.title).toBe('İthalat Tebliğinde Değişiklik')
    expect(reverted.json().draft.edits).toHaveLength(2)
    expect(reverted.json().draft.edits[0].revertedByEditId).toBe(reverted.json().draft.edits[1].id)
    await app.close()
  })

  it('discards a draft without touching published revisions', async () => {
    const { topicId } = await seedPublishedReport()
    const app = await appFor(topicId)
    await app.inject({ method: 'POST', url: `/api/v1/topics/${topicId}/draft/edits`, headers: { 'idempotency-key': crypto.randomUUID() }, payload: { edits: [{ path: 'title', value: 'Yeni Başlık' }] } })

    const discarded = await app.inject({ method: 'DELETE', url: `/api/v1/topics/${topicId}/draft` })

    expect(discarded.statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: `/api/v1/topics/${topicId}/draft` })).json()).toEqual({ draft: null })
    expect(await prisma.reportRevision.count({ where: { report: { topicId } } })).toBe(1)
    await app.close()
  })
})
