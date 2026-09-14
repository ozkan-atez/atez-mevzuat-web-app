import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { PrismaClient } from '@prisma/client'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app'
import { executeScanRun, resumeRunAfterTopicRetry } from '../../src/modules/scan-runs/application/execute-scan-run'
import type { DownloadedFile, OfficialHttp, PreviousSourceSearch } from '../../src/modules/scan-runs/application/ports'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'
import { S3ObjectStore } from '../../src/modules/scan-runs/infrastructure/s3-object-store'
import { fixtureFile } from '../helpers/files'
import type { AiModelClient, StructuredAiRequest, StructuredAiResult } from '../../src/modules/ai/application/ai-model-client'
import { PrismaTopicAnalysisRepository } from '../../src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'

const s3Config = {
  endpoint: 'http://localhost:59000',
  region: 'eu-central-1',
  bucket: 'resmi-gazete-test',
  accessKeyId: 'atez-local-access',
  secretAccessKey: 'atez-local-secret-change-me',
  forcePathStyle: true,
}

class FixtureOfficialHttp implements OfficialHttp {
  constructor(private readonly indexHtml: string, private readonly documentHtml: string) {}

  async download(url: string, _directory: string): Promise<DownloadedFile> {
    const pathname = new URL(url).pathname
    let body: string | Buffer
    let mediaType: string
    if (pathname.endsWith('20260911.htm') || pathname === '/11.09.2026') {
      body = this.indexHtml
      mediaType = 'text/html'
    } else if (pathname.endsWith('20260911-1.htm')) {
      body = this.documentHtml
      mediaType = 'text/html'
    } else if (pathname.endsWith('.htm')) {
      body = '<!doctype html><html><body>Belge</body></html>'
      mediaType = 'text/html'
    } else if (pathname.endsWith('.pdf')) {
      body = `%PDF-1.7\n${url}`
      mediaType = 'application/pdf'
    } else {
      body = Buffer.from(`fixture-image:${url}`)
      mediaType = pathname.endsWith('.gif') ? 'image/gif' : pathname.endsWith('.webp') ? 'image/webp' : 'image/png'
    }
    return { ...(await fixtureFile(body, mediaType)), sourceUrl: url }
  }
}

class MixedDecisionAi implements AiModelClient {
  async generateStructured(request: StructuredAiRequest): Promise<StructuredAiResult> {
    if (request.systemInstruction.includes('ATEZ gümrük ve dış ticaret mevzuatı analiz uzmanısın')) {
      const header = (request.parts[0] as { text: string }).text
      const topicId = header.match(/Topic kimliği: ([^\n]+)/)?.[1]
      const title = header.match(/Belge başlığı: ([^\n]+)/)?.[1] ?? 'İthalat düzenlemesi'
      if (!topicId) throw new Error('Fixture topic kimliği bulamadı')
      return {
        json: {
          schemaVersion: 1, topicId, status: 'PASS',
          document: { title, gazetteDate: '2026-09-11', gazetteNumber: '33014', sourceUrl: 'https://www.resmigazete.gov.tr/eskiler/2026/09/20260911-1.htm' },
          change: { type: 'AMENDMENT', detailedAnalysis: 'İthalat işlemlerine ilişkin uygulama güncellenmiştir.', summary: 'İthalat uygulamasında değişiklik yapılmıştır.', currentRule: 'Yeni uygulama yayım tarihinde yürürlüğe girer.', operationalImpact: 'İthalat süreçleri güncel kurala göre kontrol edilmelidir.' },
          affectedParties: [], effectiveDates: [], comparisons: [], tables: [],
          officialSources: [{ id: 'source-current', label: 'T.C. Resmî Gazete', url: 'https://www.resmigazete.gov.tr/eskiler/2026/09/20260911-1.htm', evidenceIds: ['current-document'] }],
          supportingSources: [], evidence: [{ id: 'current-document', objectKey: 'fixture/current-document.html', locator: 'body' }], unresolvedReferences: [],
          emailTitle: title, emailSummary: 'İthalat uygulamasındaki değişiklik operasyonel kontrol gerektirir.',
        },
        providerRequestId: `topic-analysis-${topicId}`, usage: { inputTokens: 20, outputTokens: 15 },
      }
    }
    if (request.systemInstruction.includes('önceki kaynak aramasını daralt')) {
      return {
        json: { needsPreviousSource: false, relationship: 'NONE', targetRegulationTitle: null, targetRegulationIdentifier: null, targetRegulationType: null, targetInstitution: null, targetArticleReferences: [], queryCandidates: [], reason: 'Bağımsız düzenleme.' },
        providerRequestId: 'preflight-response', usage: { inputTokens: 10, outputTokens: 5 },
      }
    }
    const isTitlePass = request.systemInstruction.includes('Başlık aşamasında')
    const decisions = isTitlePass
      ? (JSON.parse((request.parts[0] as { text: string }).text) as { documents: Array<{ id: string }> }).documents.map((document, index) => ({
          documentId: document.id,
          decision: index === 0 ? 'MAYBE' : index === 1 ? 'IN' : 'OUT',
          reason: index === 0 ? 'Başlık içerik incelemesi gerektiriyor.' : index === 1 ? 'Başlık dış ticaretle ilgili.' : 'Başlık kapsam dışı.',
          confidence: index === 0 ? 0.55 : 0.95,
        }))
      : request.parts
          .filter((part): part is { text: string } => 'text' in part)
          .map((part) => part.text.match(/Belge kimliği: ([^\n]+)/)?.[1])
          .filter((id): id is string => Boolean(id))
          .map((documentId) => ({ documentId, decision: 'IN', reason: 'İçerik ithalat düzenlemesi içeriyor.', confidence: 0.91 }))
    return {
      json: { decisions },
      providerRequestId: 'fixture-response', usage: { inputTokens: 10, outputTokens: 5 },
    }
  }
}

class EmptyPreviousSourceSearch implements PreviousSourceSearch {
  async search() { return [] }
  async resolveDocumentUrl(): Promise<string> { throw new Error('No source to resolve') }
}

const prisma = new PrismaClient()
const repository = new PrismaScanRepository(prisma)
const topicRepository = new PrismaTopicAnalysisRepository(prisma)
const objectStore = new S3ObjectStore(s3Config)
const s3 = new S3Client({
  endpoint: s3Config.endpoint,
  region: s3Config.region,
  forcePathStyle: true,
  credentials: { accessKeyId: s3Config.accessKeyId, secretAccessKey: s3Config.secretAccessKey },
})
let http: FixtureOfficialHttp
const aiModel = new MixedDecisionAi()
const gemini = { model: 'gemini-3.7-flash', maxAttempts: 3, maxContentBytes: 8_000_000, previousSourceConcurrency: 2, topicConcurrency: 2 }
const previousSourceSearch = new EmptyPreviousSourceSearch()

describe('manual scan acceptance', () => {
  beforeAll(async () => {
    const fixtureRoot = resolve('test/fixtures/resmi-gazete/2026-09-11')
    http = new FixtureOfficialHttp(
      await readFile(resolve(fixtureRoot, 'index.html'), 'utf8'),
      await readFile(resolve(fixtureRoot, 'document.html'), 'utf8'),
    )
    await objectStore.ensureBucket()
  })

  beforeEach(async () => {
    await prisma.scanRun.deleteMany()
    await prisma.storedObject.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
    s3.destroy()
  })

  it('archives a complete run and reuses content on a same-date rescan', async () => {
    const app = await buildApp({ scanRepository: repository })
    const requestKey = crypto.randomUUID()
    const create = () => app.inject({
      method: 'POST',
      url: '/api/v1/scan-runs',
      headers: { 'idempotency-key': requestKey },
      payload: { trigger: 'MANUAL', targetDate: '2026-09-11' },
    })

    const firstResponse = await create()
    const duplicateResponse = await create()
    const firstRunId = firstResponse.json<{ runId: string }>().runId
    expect(duplicateResponse.json<{ runId: string }>().runId).toBe(firstRunId)

    await executeScanRun(firstRunId, { repository, topicRepository, http, objectStore, maxRunBytes: 10_000_000n, aiModel, gemini, previousSourceSearch })
    const finalRun = await repository.getRun(firstRunId)
    expect(finalRun?.status).toBe('COMPLETED')
    expect(finalRun?.editions.map((edition) => edition.type)).toEqual(['MAIN', 'SUPPLEMENT', 'SUPPLEMENT'])
    expect(finalRun?.counts.documents).toBe(4)
    expect(finalRun?.counts.assets).toBe(5)
    expect(finalRun?.filter?.counts).toEqual({ in: 2, out: 2, pending: 0 })
    expect(finalRun?.analysis?.counts).toEqual({ total: 2, completed: 2, awaitingRetry: 0, failed: 0 })
    expect(finalRun?.reports).toHaveLength(2)
    expect(finalRun?.reports.every((report) => report.topicId && report.card !== 'K6')).toBe(true)
    expect(JSON.stringify(finalRun)).not.toMatch(/confidence/i)

    const decisions = await prisma.documentFilterDecision.findMany({ orderBy: { document: { publicationOrder: 'asc' } } })
    expect(decisions).toHaveLength(4)
    expect(decisions.every((decision) => decision.finalDecision === 'IN' || decision.finalDecision === 'OUT')).toBe(true)
    expect(decisions.filter((decision) => decision.titleDecision === 'MAYBE')).toHaveLength(1)
    expect(decisions.find((decision) => decision.titleDecision === 'MAYBE')).toMatchObject({ contentDecision: 'IN', finalDecision: 'IN' })
    expect(await prisma.collectedDocument.count({ where: { edition: { scanRunId: firstRunId }, storedObjectId: null } })).toBe(0)
    expect(await prisma.documentAsset.count({ where: { document: { edition: { scanRunId: firstRunId } }, storedObjectId: null } })).toBe(0)

    const storedRun = await prisma.scanRun.findUniqueOrThrow({ where: { id: firstRunId } })
    expect(storedRun.manifestObjectKey).toBeTruthy()
    await expect(s3.send(new HeadObjectCommand({ Bucket: s3Config.bucket, Key: storedRun.manifestObjectKey! }))).resolves.toBeTruthy()
    const manifestObject = await s3.send(new GetObjectCommand({ Bucket: s3Config.bucket, Key: storedRun.manifestObjectKey! }))
    const manifest = JSON.parse(await manifestObject.Body!.transformToString())
    expect(manifest.schemaVersion).toBe(4)
    expect(manifest.filterAudit.decisions).toHaveLength(4)
    expect(manifest.topicAnalysis.topics).toHaveLength(2)
    expect(manifest.reports).toHaveLength(2)
    expect(manifest.editions.flatMap((edition: { documents: unknown[] }) => edition.documents).every((document: { filter: { finalDecision: string } }) => ['IN', 'OUT'].includes(document.filter.finalDecision))).toBe(true)
    const objectsAfterFirstRun = await prisma.storedObject.findMany()
    expect(objectsAfterFirstRun.length).toBeGreaterThan(0)
    expect(objectsAfterFirstRun.every((object) => /^[0-9a-f]{64}$/.test(object.sha256))).toBe(true)
    expect(objectsAfterFirstRun.every((object) => object.objectKey.includes(object.sha256))).toBe(true)

    const executionsBeforeRedelivery = await prisma.topicAiExecution.count({ where: { topic: { scanRunId: firstRunId } } })
    await executeScanRun(firstRunId, { repository, topicRepository, http, objectStore, maxRunBytes: 10_000_000n, aiModel, gemini, previousSourceSearch })
    expect(await prisma.topicAiExecution.count({ where: { topic: { scanRunId: firstRunId } } })).toBe(executionsBeforeRedelivery)

    const bytesBeforeRecovery = (await repository.getExecutionRun(firstRunId))!.downloadedBytes
    await prisma.scanRun.update({ where: { id: firstRunId }, data: { status: 'PARTIAL', currentStage: 'WRITING_MANIFEST', manifestObjectKey: null, completedAt: null } })
    await executeScanRun(firstRunId, { repository, topicRepository, http, objectStore, maxRunBytes: 10_000_000n, aiModel, gemini, previousSourceSearch })
    expect(await prisma.topicAiExecution.count({ where: { topic: { scanRunId: firstRunId } } })).toBe(executionsBeforeRedelivery)
    expect((await repository.getExecutionRun(firstRunId))?.downloadedBytes).toBe(bytesBeforeRecovery)
    expect((await repository.getRun(firstRunId))?.status).toBe('COMPLETED')

    await prisma.scanRun.update({ where: { id: firstRunId }, data: { status: 'AWAITING_RETRY', currentStage: 'ANALYZING_TOPICS', manifestObjectKey: null, completedAt: null } })
    expect(await resumeRunAfterTopicRetry(firstRunId, { repository, topicRepository, objectStore })).toBe(true)
    expect((await repository.getRun(firstRunId))?.status).toBe('COMPLETED')

    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/scan-runs',
      headers: { 'idempotency-key': crypto.randomUUID() },
      payload: { trigger: 'MANUAL', targetDate: '2026-09-11' },
    })
    const secondRunId = secondResponse.json<{ runId: string }>().runId
    expect(secondRunId).not.toBe(firstRunId)
    await executeScanRun(secondRunId, { repository, topicRepository, http, objectStore, maxRunBytes: 10_000_000n, aiModel, gemini, previousSourceSearch })

    expect(await prisma.storedObject.count()).toBe(objectsAfterFirstRun.length)
    await app.close()
  })
})
