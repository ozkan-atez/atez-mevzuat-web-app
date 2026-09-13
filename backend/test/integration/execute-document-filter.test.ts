import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiModelClient, StructuredAiRequest, StructuredAiResult } from '../../src/modules/ai/application/ai-model-client'
import { executeDocumentFilter } from '../../src/modules/scan-runs/application/execute-document-filter'
import type { DownloadedFile, ObjectStore, OfficialHttp, StoredBlob } from '../../src/modules/scan-runs/application/ports'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'
import { fixtureFile } from '../helpers/files'

class SequenceAi implements AiModelClient {
  readonly requests: StructuredAiRequest[] = []
  constructor(private readonly responses: unknown[]) {}
  async generateStructured(request: StructuredAiRequest): Promise<StructuredAiResult> {
    this.requests.push(request)
    return { json: this.responses.shift(), providerRequestId: `response-${this.requests.length}`, usage: { inputTokens: 10, outputTokens: 5 } }
  }
}

class FilterHttp implements OfficialHttp {
  readonly download = vi.fn(async (url: string, _directory: string): Promise<DownloadedFile> => {
    const file = await fixtureFile('<html><body><h1>Düzenleme</h1><p>Yalnızca üniversite eğitimini düzenler.</p></body></html>', 'text/html')
    return { ...file, sourceUrl: url }
  })
}

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Buffer>()
  async ensureBucket(): Promise<void> {}
  async exists(key: string): Promise<boolean> { return this.objects.has(key) }
  async putContent(file: DownloadedFile): Promise<StoredBlob> {
    const bytes = await import('node:fs/promises').then(({ readFile }) => readFile(file.tempPath))
    const objectKey = `objects/${file.sha256}`
    this.objects.set(objectKey, bytes)
    return { ...file, bucket: 'test', objectKey }
  }
  async putRunFile(key: string, body: Buffer, mediaType: string): Promise<StoredBlob> {
    this.objects.set(key, body)
    return { sha256: 'f'.repeat(64), bucket: 'test', objectKey: key, mediaType, byteSize: BigInt(body.length) }
  }
  async getContent(key: string): Promise<Buffer> { return this.objects.get(key) ?? Buffer.alloc(0) }
}

const prisma = new PrismaClient()
const repository = new PrismaScanRepository(prisma)

async function seedDocuments() {
  const run = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-09-14' })
  await repository.saveEditions(run.id, run.targetDate, [{
    type: 'MAIN', supplementNo: null, indexUrl: 'https://www.resmigazete.gov.tr/14.09.2026', discoveryOrder: 0,
    documents: [
      { title: 'İthalat Rejimi Kararı', sourceUrl: 'https://www.resmigazete.gov.tr/in.htm', publicationOrder: 1 },
      { title: 'Üniversite Yönetmeliği', sourceUrl: 'https://www.resmigazete.gov.tr/maybe.htm', publicationOrder: 2 },
    ],
  }])
  return run
}

describe('executeDocumentFilter', () => {
  beforeEach(() => prisma.scanRun.deleteMany())
  afterAll(() => prisma.$disconnect())

  it('classifies every title once and completes without content when there is no MAYBE', async () => {
    const run = await seedDocuments()
    const documents = await repository.listFilterDocuments(run.id)
    const ai = new SequenceAi([{ decisions: documents.map((document, index) => ({
      documentId: document.id, decision: index === 0 ? 'IN' : 'OUT', reason: 'Başlıktan kesin.', confidence: 0.9,
    })) }])
    const http = new FilterHttp()

    await executeDocumentFilter(run.id, { repository, aiModel: ai, http, objectStore: new MemoryStore(), model: 'gemini-3.8-flash', maxAttempts: 3, maxContentBytes: 8_000_000, maxRunBytes: 10_000_000n })

    expect(ai.requests).toHaveLength(1)
    expect(http.download).not.toHaveBeenCalled()
    expect((await repository.getFilterProgress((await prisma.aiJob.findFirstOrThrow()).id)).finalCounts).toEqual({ in: 1, out: 1, pending: 0 })
  })

  it('downloads a MAYBE document once and resolves its content to final OUT', async () => {
    const run = await seedDocuments()
    const documents = await repository.listFilterDocuments(run.id)
    const ai = new SequenceAi([
      { decisions: [
        { documentId: documents[0]!.id, decision: 'IN', reason: 'İthalat.', confidence: 0.99 },
        { documentId: documents[1]!.id, decision: 'MAYBE', reason: 'İçerik gerekli.', confidence: 0.5 },
      ] },
      { decisions: [{ documentId: documents[1]!.id, decision: 'OUT', reason: 'Yalnızca eğitim.', confidence: 0.96 }] },
    ])
    const http = new FilterHttp()
    const store = new MemoryStore()

    await executeDocumentFilter(run.id, { repository, aiModel: ai, http, objectStore: store, model: 'gemini-3.8-flash', maxAttempts: 3, maxContentBytes: 8_000_000, maxRunBytes: 10_000_000n })

    expect(ai.requests).toHaveLength(2)
    expect(http.download).toHaveBeenCalledTimes(1)
    expect((await repository.listFilterDocuments(run.id))[1]!.storedObject).not.toBeNull()
    expect((await repository.getFilterProgress((await prisma.aiJob.findFirstOrThrow()).id)).finalCounts).toEqual({ in: 1, out: 1, pending: 0 })
  })
})
