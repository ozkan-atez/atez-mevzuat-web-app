import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AiModelClient, StructuredAiRequest } from '../../ai/application/ai-model-client'
import { AiProviderError, executeWithAiRetries } from '../../ai/domain/ai-errors'
import {
  buildContentFilterRequest,
  buildTitleFilterRequest,
  CONTENT_FILTER_PROMPT_VERSION,
  TITLE_FILTER_PROMPT_VERSION,
} from './document-filter-prompts'
import { parseContentFilterResponse, parseTitleFilterResponse } from './document-filter-schemas'
import { normalizeDocumentContent } from './normalize-document-content'
import type { ContentDecision, FilterDocumentRecord, ObjectStore, OfficialHttp, ScanRepository, TitleDecision } from './ports'

interface Dependencies {
  repository: ScanRepository
  aiModel: AiModelClient
  http: OfficialHttp
  objectStore: ObjectStore
  model: string
  maxAttempts: number
  maxContentBytes: number
  maxRunBytes: bigint
}

interface MaterializedDocument {
  document: FilterDocumentRecord
  bytes: Buffer
  mediaType: string
  sha256: string
}

export class AiFilterAwaitingRetryError extends Error {
  override readonly name = 'AiFilterAwaitingRetryError'
  constructor(readonly runId: string) {
    super(`AI filtering awaits retry for scan run ${runId}`)
  }
}

export async function executeDocumentFilter(runId: string, dependencies: Dependencies): Promise<void> {
  const { repository, model } = dependencies
  const documents = await repository.listFilterDocuments(runId)
  const titleRequest = buildTitleFilterRequest(documents.map((document) => ({
    id: document.id,
    title: document.title,
    publicationOrder: document.publicationOrder,
    editionLabel: document.editionLabel,
  })), model)
  const job = await repository.getOrCreateDocumentFilterJob(runId, {
    model,
    titlePromptVersion: TITLE_FILTER_PROMPT_VERSION,
    contentPromptVersion: CONTENT_FILTER_PROMPT_VERSION,
    configurationHash: titleRequest.configurationHash,
  })
  if (job.status === 'COMPLETED') return
  await repository.markFilterRunning(runId, job.id, documents.length)

  try {
    let progress = await repository.getFilterProgress(job.id)
    if (!progress.titlePassComplete) {
      const decisions = await generateWithAudit({
        jobId: job.id,
        phase: 'TITLE',
        batchKey: 'all-titles',
        request: titleRequest.request,
        expectedIds: documents.map((document) => document.id),
        dependencies,
        parse: parseTitleFilterResponse,
      })
      await repository.saveTitleDecisions(job.id, decisions)
      progress = await repository.getFilterProgress(job.id)
    }

    if (progress.unresolvedDocumentIds.length > 0) {
      await resolveAmbiguousDocuments(runId, job.id, documents, progress.unresolvedDocumentIds, dependencies)
      progress = await repository.getFilterProgress(job.id)
    }
    if (progress.finalCounts.pending !== 0) throw new Error('Document filter completed without final decisions')
    await repository.completeFilter(runId, job.id)
  } catch (error) {
    if (!(error instanceof AiProviderError)) throw error
    await repository.markFilterAwaitingRetry(runId, job.id, {
      category: error.category,
      providerStatus: error.providerStatus,
      message: error.message,
    })
    throw new AiFilterAwaitingRetryError(runId)
  }
}

async function resolveAmbiguousDocuments(
  runId: string,
  jobId: string,
  allDocuments: FilterDocumentRecord[],
  unresolvedIds: string[],
  dependencies: Dependencies,
): Promise<void> {
  const tempDirectory = await mkdtemp(join(tmpdir(), `atez-filter-${runId}-`))
  try {
    const byId = new Map(allDocuments.map((document) => [document.id, document]))
    const materialized: MaterializedDocument[] = []
    for (const id of unresolvedIds) {
      const document = byId.get(id)
      if (!document) throw new Error(`Filter document not found: ${id}`)
      materialized.push(await materializeDocument(runId, document, tempDirectory, dependencies))
    }
    for (const batch of createBatches(materialized, dependencies.maxContentBytes)) {
      const batchKey = createHash('sha256').update(batch.map((item) => `${item.document.id}:${item.sha256}`).join('|')).digest('hex')
      const parts = batch.flatMap((item) => normalizeDocumentContent({
        id: item.document.id,
        title: item.document.title,
        mediaType: item.mediaType,
        bytes: item.bytes,
      }))
      const decisions = await generateWithAudit({
        jobId,
        phase: 'CONTENT',
        batchKey,
        request: buildContentFilterRequest({ model: dependencies.model, documentParts: parts }),
        expectedIds: batch.map((item) => item.document.id),
        dependencies,
        parse: parseContentFilterResponse,
      })
      await dependencies.repository.saveContentDecisions(jobId, batchKey, decisions)
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

async function materializeDocument(
  runId: string,
  document: FilterDocumentRecord,
  tempDirectory: string,
  dependencies: Dependencies,
): Promise<MaterializedDocument> {
  if (document.storedObject) {
    return {
      document,
      bytes: await dependencies.objectStore.getContent(document.storedObject.objectKey),
      mediaType: document.storedObject.mediaType,
      sha256: document.storedObject.sha256,
    }
  }
  const file = await dependencies.http.download(document.sourceUrl, tempDirectory)
  const run = await dependencies.repository.getExecutionRun(runId)
  if (!run || run.downloadedBytes + file.byteSize > dependencies.maxRunBytes) {
    throw new Error('Scan exceeds the configured total byte limit')
  }
  const object = await dependencies.objectStore.putContent(file)
  await dependencies.repository.attachDocumentObject(document.id, object)
  await dependencies.repository.addDownloadedBytes(runId, file.byteSize)
  return { document, bytes: await readFile(file.tempPath), mediaType: file.mediaType, sha256: file.sha256 }
}

function createBatches(documents: MaterializedDocument[], maximumBytes: number): MaterializedDocument[][] {
  const batches: MaterializedDocument[][] = []
  let current: MaterializedDocument[] = []
  let currentBytes = 0
  for (const document of documents) {
    if (document.bytes.byteLength > maximumBytes) {
      throw new AiProviderError('CONTENT_REJECTED', false, `Belge Gemini içerik sınırını aşıyor: ${document.document.id}`)
    }
    if (current.length > 0 && currentBytes + document.bytes.byteLength > maximumBytes) {
      batches.push(current)
      current = []
      currentBytes = 0
    }
    current.push(document)
    currentBytes += document.bytes.byteLength
  }
  if (current.length > 0) batches.push(current)
  return batches
}

async function generateWithAudit<T extends TitleDecision[] | ContentDecision[]>(input: {
  jobId: string
  phase: 'TITLE' | 'CONTENT'
  batchKey: string
  request: StructuredAiRequest
  expectedIds: string[]
  dependencies: Dependencies
  parse: (raw: unknown, expectedIds: string[]) => T
}): Promise<T> {
  return executeWithAiRetries(async () => {
    const attemptNo = await input.dependencies.repository.nextAiCallAttempt(input.jobId, input.phase, input.batchKey)
    const inputHash = createHash('sha256').update(JSON.stringify(input.request.parts)).digest('hex')
    const call = await input.dependencies.repository.startAiCall({ aiJobId: input.jobId, phase: input.phase, batchKey: input.batchKey, attemptNo, inputHash })
    const startedAt = Date.now()
    try {
      const result = await input.dependencies.aiModel.generateStructured(input.request)
      let parsed: T
      try {
        parsed = input.parse(result.json, input.expectedIds)
      } catch {
        throw new AiProviderError('INVALID_RESPONSE', true, 'Gemini geçerli bir yapılandırılmış yanıt döndürmedi.')
      }
      await input.dependencies.repository.completeAiCall(call.id, {
        providerRequestId: result.providerRequestId,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        latencyMs: Date.now() - startedAt,
      })
      return parsed
    } catch (error) {
      const providerError = error instanceof AiProviderError
        ? error
        : new AiProviderError('UNKNOWN_PROVIDER_ERROR', false, 'Gemini isteği bilinmeyen bir nedenle başarısız oldu.')
      await input.dependencies.repository.failAiCall(call.id, {
        category: providerError.category,
        providerStatus: providerError.providerStatus,
        message: providerError.message,
      })
      throw providerError
    }
  }, { maxAttempts: input.dependencies.maxAttempts })
}
