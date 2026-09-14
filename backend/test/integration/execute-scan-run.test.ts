import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { executeScanRun } from '../../src/modules/scan-runs/application/execute-scan-run'
import type { AiModelClient, StructuredAiRequest, StructuredAiResult } from '../../src/modules/ai/application/ai-model-client'
import type { DownloadedFile, ObjectStore, OfficialHttp, PreviousSourceSearch, StoredBlob } from '../../src/modules/scan-runs/application/ports'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'
import { fixtureFile } from '../helpers/files'
import { AiProviderError } from '../../src/modules/ai/domain/ai-errors'

class FixtureHttp implements OfficialHttp {
  readonly calls: string[] = []
  async download(url: string, _directory: string): Promise<DownloadedFile> {
    this.calls.push(url)
    let file: DownloadedFile
    if (url.endsWith('.png')) {
      file = await fixtureFile(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64'), 'image/png')
    } else if (url.endsWith('.htm')) {
      file = await fixtureFile('<!doctype html><html><body><img src="./chart.png"></body></html>', 'text/html')
    } else {
      file = await fixtureFile('<!doctype html><html><body><a href="/eskiler/2026/07/20260711-1.htm">Karar</a></body></html>', 'text/html')
    }
    return { ...file, sourceUrl: url }
  }
}

class MemoryObjectStore implements ObjectStore {
  readonly runFiles: string[] = []
  readonly objects = new Map<string, Buffer>()
  async ensureBucket(): Promise<void> {}
  async exists(): Promise<boolean> { return false }
  async getContent(key: string): Promise<Buffer> { return this.objects.get(key) ?? Buffer.alloc(0) }
  async putContent(file: DownloadedFile): Promise<StoredBlob> {
    const objectKey = `objects/${file.sha256}`
    this.objects.set(objectKey, await import('node:fs/promises').then(({ readFile }) => readFile(file.tempPath)))
    return { ...file, bucket: 'test', objectKey }
  }
  async putRunFile(key: string, body: Buffer, mediaType: string): Promise<StoredBlob> {
    this.runFiles.push(key)
    return { sha256: 'f'.repeat(64), bucket: 'test', objectKey: key, mediaType, byteSize: BigInt(body.length) }
  }
}

class AllInAi implements AiModelClient {
  readonly requests: StructuredAiRequest[] = []
  async generateStructured(request: StructuredAiRequest): Promise<StructuredAiResult> {
    this.requests.push(request)
    if (request.systemInstruction.includes('önceki kaynak aramasını daralt')) {
      return {
        json: { needsPreviousSource: false, relationship: 'NONE', targetRegulationTitle: null, targetRegulationIdentifier: null, targetRegulationType: null, targetInstitution: null, targetArticleReferences: [], queryCandidates: [], reason: 'Bağımsız düzenleme.' },
        providerRequestId: 'preflight-response', usage: { inputTokens: 10, outputTokens: 5 },
      }
    }
    const payload = JSON.parse((request.parts[0] as { text: string }).text) as { documents: Array<{ id: string }> }
    return {
      json: { decisions: payload.documents.map((document) => ({ documentId: document.id, decision: 'IN', reason: 'Gümrükle ilgili.', confidence: 0.98 })) },
      providerRequestId: 'fixture-response', usage: { inputTokens: 10, outputTokens: 5 },
    }
  }
}

class EmptyPreviousSourceSearch implements PreviousSourceSearch {
  async search() { return [] }
  async resolveDocumentUrl(): Promise<string> { throw new Error('No source to resolve') }
}

class RateLimitedAi implements AiModelClient {
  async generateStructured(): Promise<StructuredAiResult> {
    throw new AiProviderError('RATE_LIMITED', true, 'Gemini geçici olarak yoğun.', 429)
  }
}

const prisma = new PrismaClient()
const repository = new PrismaScanRepository(prisma)

describe('executeScanRun', () => {
  beforeEach(async () => {
    await prisma.scanRun.deleteMany()
  })
  afterAll(() => prisma.$disconnect())

  it('writes the manifest before completing a fully collected run', async () => {
    const run = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-07-11' })
    const objectStore = new MemoryObjectStore()
    const aiModel = new AllInAi()

    await executeScanRun(run.id, {
      repository,
      http: new FixtureHttp(),
      objectStore,
      maxRunBytes: 10_000n,
      aiModel,
      previousSourceSearch: new EmptyPreviousSourceSearch(),
      gemini: { model: 'gemini-3.8-flash', maxAttempts: 3, maxContentBytes: 8_000_000, previousSourceConcurrency: 2 },
    })

    const saved = await prisma.scanRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(saved.status).toBe('COMPLETED')
    expect(saved.manifestObjectKey).toBe(`runs/2026/07/11/${run.id}/manifest.json`)
    expect(objectStore.runFiles.at(-1)).toBe(saved.manifestObjectKey)
    expect(await prisma.collectedDocument.count()).toBe(1)
    expect(await prisma.documentAsset.count()).toBe(1)
    expect(aiModel.requests).toHaveLength(2)
    expect((await prisma.stageExecution.findMany({ where: { scanRunId: run.id }, orderBy: { createdAt: 'asc' }, select: { stage: true } })).map((stage) => stage.stage)).toEqual([
      'DISCOVERING', 'AI_FILTERING', 'DOWNLOADING_DOCUMENTS', 'DISCOVERING_ASSETS', 'DOWNLOADING_ASSETS', 'VALIDATING', 'DISCOVERING_PREVIOUS_SOURCES', 'WRITING_MANIFEST',
    ])
  })

  it('resumes the same paused run from AI filtering without repeating discovery', async () => {
    const run = await repository.createManualRun({ requestKey: crypto.randomUUID(), targetDate: '2026-07-11' })
    const http = new FixtureHttp()
    const objectStore = new MemoryObjectStore()

    await executeScanRun(run.id, {
      repository, http, objectStore, maxRunBytes: 10_000n, aiModel: new RateLimitedAi(), previousSourceSearch: new EmptyPreviousSourceSearch(),
      gemini: { model: 'gemini-3.8-flash', maxAttempts: 1, maxContentBytes: 8_000_000, previousSourceConcurrency: 2 },
    })

    expect((await repository.getRun(run.id))?.status).toBe('AWAITING_RETRY')
    const discoveryCalls = http.calls.length

    await executeScanRun(run.id, {
      repository, http, objectStore, maxRunBytes: 10_000n, aiModel: new AllInAi(), previousSourceSearch: new EmptyPreviousSourceSearch(),
      gemini: { model: 'gemini-3.8-flash', maxAttempts: 1, maxContentBytes: 8_000_000, previousSourceConcurrency: 2 },
    }, 'RETRY_AI_FILTER')

    expect((await repository.getRun(run.id))?.status).toBe('COMPLETED')
    expect(http.calls.slice(0, discoveryCalls)).toHaveLength(discoveryCalls)
    expect(http.calls.filter((url) => url.endsWith('/11.07.2026') || url.endsWith('/20260711.htm'))).toHaveLength(1)
  })
})
