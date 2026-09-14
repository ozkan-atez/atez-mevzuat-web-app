import { readFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { AiModelClient, StructuredAiRequest, StructuredAiResult } from '../../src/modules/ai/application/ai-model-client'
import { executePreviousSourceDiscovery, PreviousSourceAwaitingRetryError } from '../../src/modules/scan-runs/application/execute-previous-source-discovery'
import { AiProviderError } from '../../src/modules/ai/domain/ai-errors'
import type {
  DownloadedFile, ObjectStore, OfficialHttp, PreviousSourceSearch, PreviousSourceSearchCandidate, StoredBlob,
} from '../../src/modules/scan-runs/application/ports'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'
import { fixtureFile } from '../helpers/files'

class FixedAi implements AiModelClient {
  readonly requests: StructuredAiRequest[] = []
  async generateStructured(request: StructuredAiRequest): Promise<StructuredAiResult> {
    this.requests.push(request)
    return {
      json: {
        needsPreviousSource: true,
        relationship: 'AMENDS',
        targetRegulationTitle: 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ',
        targetRegulationIdentifier: '2018/5',
        targetRegulationType: 'TEBLIG',
        targetInstitution: 'Ticaret Bakanlığı',
        targetArticleReferences: ['1 inci madde', 'tablo'],
        queryCandidates: ['2018/5'],
        reason: 'Tablo değiştiriliyor.',
      },
      providerRequestId: 'preflight-1',
      usage: { inputTokens: 50, outputTokens: 20 },
    }
  }
}

class SequenceAi implements AiModelClient {
  calls = 0
  constructor(private readonly failAt: number | null) {}
  async generateStructured(): Promise<StructuredAiResult> {
    this.calls += 1
    if (this.failAt === this.calls) throw new AiProviderError('RATE_LIMITED', true, 'Gemini geçici olarak yoğun.', 429)
    return {
      json: {
        needsPreviousSource: false, relationship: 'NONE', targetRegulationTitle: null,
        targetRegulationIdentifier: null, targetRegulationType: null, targetInstitution: null,
        targetArticleReferences: [], queryCandidates: [], reason: 'Önceki kaynak gerekmiyor.',
      },
      providerRequestId: `preflight-${this.calls}`,
      usage: { inputTokens: 10, outputTokens: 5 },
    }
  }
}

class FixedSearch implements PreviousSourceSearch {
  readonly candidate: PreviousSourceSearchCandidate = {
    query: '2018/5',
    title: 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ (Tebliğ No: 2018/5)’de Değişiklik Yapılmasına Dair Tebliğ',
    publicationDate: '2025-12-31', gazetteNo: '33124', mukerrer: 'EVET4',
    url: 'https://www.resmigazete.gov.tr/fihrist?tarih=2025-12-31&mukerrer=4', regulationType: 'TEBLİĞLER',
  }
  async search(): Promise<PreviousSourceSearchCandidate[]> { return [this.candidate] }
  async resolveDocumentUrl(): Promise<string> { return 'https://www.resmigazete.gov.tr/eskiler/2025/12/20251231M4-39.htm' }
}

class FlakyResolveSearch extends FixedSearch {
  resolveAttempts = 0
  override async resolveDocumentUrl(): Promise<string> {
    this.resolveAttempts += 1
    if (this.resolveAttempts === 1) throw new Error('Temporary archive index failure')
    return super.resolveDocumentUrl()
  }
}

class NeverAi implements AiModelClient {
  calls = 0
  async generateStructured(): Promise<StructuredAiResult> {
    this.calls += 1
    throw new Error('AI must not be called after its intent has been persisted')
  }
}

class SourceHttp implements OfficialHttp {
  async download(url: string): Promise<DownloadedFile> {
    if (url.endsWith('image001.png')) {
      const file = await fixtureFile(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png')
      return { ...file, sourceUrl: url }
    }
    const file = await fixtureFile('<html><body><h1>Tebliğ No: 2018/5</h1><img src="image001.png"></body></html>', 'text/html')
    return { ...file, sourceUrl: url }
  }
}

class FailFirstAssetHttp extends SourceHttp {
  readonly calls: string[] = []
  private failed = false
  override async download(url: string): Promise<DownloadedFile> {
    this.calls.push(url)
    if (url.endsWith('image001.png') && !this.failed) {
      this.failed = true
      throw new Error('Temporary asset failure')
    }
    return super.download(url)
  }
}

class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Buffer>()
  async ensureBucket(): Promise<void> {}
  async exists(key: string): Promise<boolean> { return this.objects.has(key) }
  async putContent(file: DownloadedFile): Promise<StoredBlob> {
    const objectKey = `objects/${file.sha256}`
    this.objects.set(objectKey, await readFile(file.tempPath))
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

describe('executePreviousSourceDiscovery', () => {
  beforeEach(() => prisma.scanRun.deleteMany())
  afterAll(() => prisma.$disconnect())

  it('archives the verified preceding document and its supported assets for an IN document', async () => {
    const run = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-07-11' })
    await repository.saveEditions(run.id, run.targetDate, [{
      type: 'MAIN', supplementNo: null, indexUrl: 'https://www.resmigazete.gov.tr/11.07.2026', discoveryOrder: 0,
      documents: [{
        title: 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ (Tebliğ No: 2018/5)’de Değişiklik',
        sourceUrl: 'https://www.resmigazete.gov.tr/eskiler/2026/07/20260711-31.htm', publicationOrder: 1,
      }],
    }])
    const [document] = await repository.listFilterDocuments(run.id)
    const store = new MemoryStore()
    const current = await fixtureFile('<html><body><p>Tebliğ No: 2018/5’in 1 inci maddesindeki tablo değiştirilmiştir.</p></body></html>', 'text/html')
    const currentObject = await store.putContent(current)
    await repository.attachDocumentObject(document!.id, currentObject)
    const filterJob = await repository.getOrCreateDocumentFilterJob(run.id, {
      model: 'gemini-3.7-flash', titlePromptVersion: 'title-v1', contentPromptVersion: 'content-v1', configurationHash: 'a'.repeat(64),
    })
    await repository.markFilterRunning(run.id, filterJob.id, 1)
    await repository.saveTitleDecisions(filterJob.id, [{ documentId: document!.id, decision: 'IN', reason: 'İlgili.', confidence: 0.9 }])

    const ai = new FixedAi()
    await executePreviousSourceDiscovery(run.id, {
      repository, aiModel: ai, search: new FixedSearch(), http: new SourceHttp(), objectStore: store,
      model: 'gemini-3.7-flash', maxAttempts: 1, concurrency: 2, maxRunBytes: 10_000_000n,
    })

    const job = await prisma.previousSourceJob.findFirstOrThrow({ include: { source: { include: { storedObject: true, assets: true } }, candidates: true, calls: true } })
    expect(job).toMatchObject({ status: 'COMPLETED', outcome: 'VERIFIED', targetRegulationIdentifier: '2018/5' })
    expect(job.source).toMatchObject({ publicationDate: new Date('2025-12-31'), gazetteNo: '33124', validationStatus: 'VALID' })
    expect(job.source?.assets).toHaveLength(1)
    expect(job.candidates).toHaveLength(1)
    expect(job.calls).toMatchObject([{ status: 'COMPLETED', providerRequestId: 'preflight-1' }])
    expect(ai.requests[0]?.parts[0]).toMatchObject({ text: expect.stringContaining('2018/5') })
  })

  it('keeps completed document jobs intact and resumes only the failed job', async () => {
    const run = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-07-11' })
    await repository.saveEditions(run.id, run.targetDate, [{
      type: 'MAIN', supplementNo: null, indexUrl: 'https://www.resmigazete.gov.tr/11.07.2026', discoveryOrder: 0,
      documents: [
        { title: 'Birinci ilgili belge', sourceUrl: 'https://www.resmigazete.gov.tr/eskiler/2026/07/20260711-1.htm', publicationOrder: 1 },
        { title: 'İkinci ilgili belge', sourceUrl: 'https://www.resmigazete.gov.tr/eskiler/2026/07/20260711-2.htm', publicationOrder: 2 },
      ],
    }])
    const documents = await repository.listFilterDocuments(run.id)
    const store = new MemoryStore()
    for (const document of documents) {
      const file = await fixtureFile(`<html><body>${document.title}</body></html>`, 'text/html')
      await repository.attachDocumentObject(document.id, await store.putContent(file))
    }
    const filterJob = await repository.getOrCreateDocumentFilterJob(run.id, {
      model: 'gemini-3.7-flash', titlePromptVersion: 'title-v1', contentPromptVersion: 'content-v1', configurationHash: 'a'.repeat(64),
    })
    await repository.markFilterRunning(run.id, filterJob.id, documents.length)
    await repository.saveTitleDecisions(filterJob.id, documents.map((document) => ({ documentId: document.id, decision: 'IN' as const, reason: 'İlgili.', confidence: 0.9 })))

    const firstAi = new SequenceAi(2)
    await expect(executePreviousSourceDiscovery(run.id, {
      repository, aiModel: firstAi, search: new FixedSearch(), http: new SourceHttp(), objectStore: store,
      model: 'gemini-3.7-flash', maxAttempts: 1, concurrency: 1, maxRunBytes: 10_000_000n,
    })).rejects.toBeInstanceOf(PreviousSourceAwaitingRetryError)

    const afterFailure = await prisma.previousSourceJob.findMany({ orderBy: { document: { publicationOrder: 'asc' } }, include: { calls: true } })
    expect(afterFailure.map((job) => job.status)).toEqual(['COMPLETED', 'AWAITING_RETRY'])
    expect(afterFailure[0]?.calls).toHaveLength(1)

    const retryAi = new SequenceAi(null)
    await executePreviousSourceDiscovery(run.id, {
      repository, aiModel: retryAi, search: new FixedSearch(), http: new SourceHttp(), objectStore: store,
      model: 'gemini-3.7-flash', maxAttempts: 1, concurrency: 1, maxRunBytes: 10_000_000n,
    })

    const completed = await prisma.previousSourceJob.findMany({ orderBy: { document: { publicationOrder: 'asc' } }, include: { calls: true } })
    expect(completed.map((job) => job.status)).toEqual(['COMPLETED', 'COMPLETED'])
    expect(completed[0]?.calls).toHaveLength(1)
    expect(completed[1]?.calls).toHaveLength(2)
    expect(retryAi.calls).toBe(1)
  })

  it('reuses a persisted AI intent when retrying a later archive failure', async () => {
    const run = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-07-11' })
    await repository.saveEditions(run.id, run.targetDate, [{
      type: 'MAIN', supplementNo: null, indexUrl: 'https://www.resmigazete.gov.tr/11.07.2026', discoveryOrder: 0,
      documents: [{ title: '2018/5 değişikliği', sourceUrl: 'https://www.resmigazete.gov.tr/eskiler/2026/07/20260711-31.htm', publicationOrder: 1 }],
    }])
    const [document] = await repository.listFilterDocuments(run.id)
    const store = new MemoryStore()
    const current = await fixtureFile('<html><body>Tebliğ No: 2018/5’in tablosu değiştirilmiştir.</body></html>', 'text/html')
    await repository.attachDocumentObject(document!.id, await store.putContent(current))
    const filterJob = await repository.getOrCreateDocumentFilterJob(run.id, {
      model: 'gemini-3.7-flash', titlePromptVersion: 'title-v1', contentPromptVersion: 'content-v1', configurationHash: 'a'.repeat(64),
    })
    await repository.markFilterRunning(run.id, filterJob.id, 1)
    await repository.saveTitleDecisions(filterJob.id, [{ documentId: document!.id, decision: 'IN', reason: 'İlgili.', confidence: 0.9 }])
    const search = new FlakyResolveSearch()

    await expect(executePreviousSourceDiscovery(run.id, {
      repository, aiModel: new FixedAi(), search, http: new SourceHttp(), objectStore: store,
      model: 'gemini-3.7-flash', maxAttempts: 1, concurrency: 1, maxRunBytes: 10_000_000n,
    })).rejects.toBeInstanceOf(PreviousSourceAwaitingRetryError)

    const retryAi = new NeverAi()
    await executePreviousSourceDiscovery(run.id, {
      repository, aiModel: retryAi, search, http: new SourceHttp(), objectStore: store,
      model: 'gemini-3.7-flash', maxAttempts: 1, concurrency: 1, maxRunBytes: 10_000_000n,
    })
    expect(retryAi.calls).toBe(0)
    expect(search.resolveAttempts).toBe(2)
  })

  it('reuses an archived previous document when a later asset download is retried', async () => {
    const run = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-07-11' })
    await repository.saveEditions(run.id, run.targetDate, [{
      type: 'MAIN', supplementNo: null, indexUrl: 'https://www.resmigazete.gov.tr/11.07.2026', discoveryOrder: 0,
      documents: [{ title: '2018/5 değişikliği', sourceUrl: 'https://www.resmigazete.gov.tr/eskiler/2026/07/20260711-31.htm', publicationOrder: 1 }],
    }])
    const [document] = await repository.listFilterDocuments(run.id)
    const store = new MemoryStore()
    await repository.attachDocumentObject(document!.id, await store.putContent(await fixtureFile('<html><body>2018/5</body></html>', 'text/html')))
    const filterJob = await repository.getOrCreateDocumentFilterJob(run.id, {
      model: 'gemini-3.7-flash', titlePromptVersion: 'title-v1', contentPromptVersion: 'content-v1', configurationHash: 'a'.repeat(64),
    })
    await repository.markFilterRunning(run.id, filterJob.id, 1)
    await repository.saveTitleDecisions(filterJob.id, [{ documentId: document!.id, decision: 'IN', reason: 'İlgili.', confidence: 0.9 }])
    const http = new FailFirstAssetHttp()

    await expect(executePreviousSourceDiscovery(run.id, {
      repository, aiModel: new FixedAi(), search: new FixedSearch(), http, objectStore: store,
      model: 'gemini-3.7-flash', maxAttempts: 1, concurrency: 1, maxRunBytes: 10_000_000n,
    })).rejects.toBeInstanceOf(PreviousSourceAwaitingRetryError)
    const bytesAfterSource = (await repository.getExecutionRun(run.id))!.downloadedBytes

    await executePreviousSourceDiscovery(run.id, {
      repository, aiModel: new NeverAi(), search: new FixedSearch(), http, objectStore: store,
      model: 'gemini-3.7-flash', maxAttempts: 1, concurrency: 1, maxRunBytes: 10_000_000n,
    })

    const sourceUrl = 'https://www.resmigazete.gov.tr/eskiler/2025/12/20251231M4-39.htm'
    expect(http.calls.filter((url) => url === sourceUrl)).toHaveLength(1)
    expect((await repository.getExecutionRun(run.id))!.downloadedBytes).toBeGreaterThan(bytesAfterSource)
    const job = await prisma.previousSourceJob.findFirstOrThrow({ include: { source: { include: { assets: true } } } })
    expect(job).toMatchObject({ status: 'COMPLETED', outcome: 'VERIFIED' })
    expect(job.source?.assets).toHaveLength(1)
  })
})
