import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { PrismaClient } from '@prisma/client'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app'
import { executeScanRun } from '../../src/modules/scan-runs/application/execute-scan-run'
import type { DownloadedFile, OfficialHttp } from '../../src/modules/scan-runs/application/ports'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'
import { S3ObjectStore } from '../../src/modules/scan-runs/infrastructure/s3-object-store'
import { fixtureFile } from '../helpers/files'
import type { AiModelClient, StructuredAiRequest, StructuredAiResult } from '../../src/modules/ai/application/ai-model-client'

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
    if (pathname.endsWith('20260711.htm') || pathname === '/11.07.2026') {
      body = this.indexHtml
      mediaType = 'text/html'
    } else if (pathname.endsWith('20260711-1.htm')) {
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

const prisma = new PrismaClient()
const repository = new PrismaScanRepository(prisma)
const objectStore = new S3ObjectStore(s3Config)
const s3 = new S3Client({
  endpoint: s3Config.endpoint,
  region: s3Config.region,
  forcePathStyle: true,
  credentials: { accessKeyId: s3Config.accessKeyId, secretAccessKey: s3Config.secretAccessKey },
})
let http: FixtureOfficialHttp
const aiModel = new MixedDecisionAi()
const gemini = { model: 'gemini-3.8-flash', maxAttempts: 3, maxContentBytes: 8_000_000 }

describe('manual scan acceptance', () => {
  beforeAll(async () => {
    const fixtureRoot = resolve('test/fixtures/resmi-gazete/2026-07-11')
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
      payload: { trigger: 'MANUAL', targetDate: '2026-07-11' },
    })

    const firstResponse = await create()
    const duplicateResponse = await create()
    const firstRunId = firstResponse.json<{ runId: string }>().runId
    expect(duplicateResponse.json<{ runId: string }>().runId).toBe(firstRunId)

    await executeScanRun(firstRunId, { repository, http, objectStore, maxRunBytes: 10_000_000n, aiModel, gemini })
    const finalRun = await repository.getRun(firstRunId)
    expect(finalRun?.status).toBe('COMPLETED')
    expect(finalRun?.editions.map((edition) => edition.type)).toEqual(['MAIN', 'SUPPLEMENT', 'SUPPLEMENT'])
    expect(finalRun?.counts.documents).toBe(4)
    expect(finalRun?.counts.assets).toBe(5)
    expect(finalRun?.filter?.counts).toEqual({ in: 2, out: 2, pending: 0 })
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
    expect(manifest.schemaVersion).toBe(2)
    expect(manifest.filterAudit.decisions).toHaveLength(4)
    expect(manifest.editions.flatMap((edition: { documents: unknown[] }) => edition.documents).every((document: { filter: { finalDecision: string } }) => ['IN', 'OUT'].includes(document.filter.finalDecision))).toBe(true)
    const objectsAfterFirstRun = await prisma.storedObject.findMany()
    expect(objectsAfterFirstRun.length).toBeGreaterThan(0)
    expect(objectsAfterFirstRun.every((object) => /^[0-9a-f]{64}$/.test(object.sha256))).toBe(true)
    expect(objectsAfterFirstRun.every((object) => object.objectKey.includes(object.sha256))).toBe(true)

    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/scan-runs',
      headers: { 'idempotency-key': crypto.randomUUID() },
      payload: { trigger: 'MANUAL', targetDate: '2026-07-11' },
    })
    const secondRunId = secondResponse.json<{ runId: string }>().runId
    expect(secondRunId).not.toBe(firstRunId)
    await executeScanRun(secondRunId, { repository, http, objectStore, maxRunBytes: 10_000_000n, aiModel, gemini })

    expect(await prisma.storedObject.count()).toBe(objectsAfterFirstRun.length)
    await app.close()
  })
})
