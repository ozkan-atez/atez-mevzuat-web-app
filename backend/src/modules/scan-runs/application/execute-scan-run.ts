import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ObjectStore, OfficialHttp, PreviousSourceSearch } from './ports'
import type { AiModelClient } from '../../ai/application/ai-model-client'
import type { PrismaScanRepository } from '../infrastructure/prisma-scan-repository'
import { candidateIndexUrls, parseAssets, parseEditions } from '../infrastructure/resmi-gazete-parser'
import { buildManifest } from './build-manifest'
import type { ScanStage } from '../domain/scan-run'
import { AiFilterAwaitingRetryError, executeDocumentFilter } from './execute-document-filter'
import { executePreviousSourceDiscovery, PreviousSourceAwaitingRetryError } from './execute-previous-source-discovery'
import { PREVIOUS_SOURCE_CONFIGURATION_HASH, PREVIOUS_SOURCE_PROMPT_VERSION } from './previous-source-prompts'

interface Dependencies {
  repository: PrismaScanRepository
  http: OfficialHttp
  objectStore: ObjectStore
  maxRunBytes: bigint
  aiModel: AiModelClient
  previousSourceSearch: PreviousSourceSearch
  gemini: { model: string; maxAttempts: number; maxContentBytes: number; previousSourceConcurrency: number }
}

export async function executeScanRun(runId: string, dependencies: Dependencies, command: 'START_SCAN' | 'RETRY_AI_FILTER' | 'RETRY_PREVIOUS_SOURCES' = 'START_SCAN'): Promise<void> {
  const { repository, http, objectStore, maxRunBytes } = dependencies
  const run = await repository.getExecutionRun(runId)
  if (!run) throw new Error(`Scan run not found: ${runId}`)
  const tempDirectory = await mkdtemp(join(tmpdir(), `atez-scan-${runId}-`))
  let currentStage: ScanStage = 'DISCOVERING'
  let bytes = run.downloadedBytes

  try {
    await objectStore.ensureBucket()
    const datePath = run.targetDate.replaceAll('-', '/')
    if (command === 'START_SCAN') {
      await repository.startRun(runId)
      await repository.startStage(runId, currentStage, 1)

      const indexFile = await downloadFirstAvailable(http, candidateIndexUrls(run.targetDate), tempDirectory)
      bytes = addWithinLimit(bytes, indexFile.byteSize, maxRunBytes)
      const indexKey = `runs/${datePath}/${runId}/index.html`
      const indexBytes = await readFile(indexFile.tempPath)
      const storedIndex = await objectStore.putRunFile(indexKey, indexBytes, 'text/html')
      await repository.saveIndex(runId, indexFile.sourceUrl, storedIndex)
      const editions = parseEditions(indexBytes.toString('utf8'), indexFile.sourceUrl, run.targetDate)
      if (editions.length === 0) throw new Error('No official publications were discovered for the selected date')
      await repository.saveEditions(runId, run.targetDate, editions)
      await repository.advanceStage(runId, currentStage, indexFile.byteSize)
      await repository.completeStage(runId, currentStage)
    }

    if (command !== 'RETRY_PREVIOUS_SOURCES') {
    currentStage = 'AI_FILTERING'
    await executeDocumentFilter(runId, {
      repository,
      aiModel: dependencies.aiModel,
      http,
      objectStore,
      model: dependencies.gemini.model,
      maxAttempts: dependencies.gemini.maxAttempts,
      maxContentBytes: dependencies.gemini.maxContentBytes,
      maxRunBytes,
    })
    bytes = (await repository.getExecutionRun(runId))?.downloadedBytes ?? bytes

    currentStage = 'DOWNLOADING_DOCUMENTS'
    const documents = await repository.listFilterDocuments(runId)
    await repository.startStage(runId, currentStage, documents.length)
    const downloadedDocuments = new Map<string, { tempPath: string; mediaType: string }>()
    for (const document of documents) {
      if (document.storedObject) {
        const tempPath = join(tempDirectory, `stored-${document.id}`)
        await writeFile(tempPath, await objectStore.getContent(document.storedObject.objectKey))
        downloadedDocuments.set(document.id, { tempPath, mediaType: document.storedObject.mediaType })
        await repository.advanceStage(runId, currentStage, 0n)
        continue
      }
      const file = await http.download(document.sourceUrl, tempDirectory)
      bytes = addWithinLimit(bytes, file.byteSize, maxRunBytes)
      const object = await objectStore.putContent(file)
      await repository.attachDocumentObject(document.id, object)
      downloadedDocuments.set(document.id, { tempPath: file.tempPath, mediaType: file.mediaType })
      await repository.advanceStage(runId, currentStage, file.byteSize)
    }
    await repository.completeStage(runId, currentStage)

    currentStage = 'DISCOVERING_ASSETS'
    await repository.startStage(runId, currentStage, documents.length)
    for (const document of documents) {
      const downloaded = downloadedDocuments.get(document.id)
      if (downloaded?.mediaType === 'text/html') {
        const html = await readFile(downloaded.tempPath, 'utf8')
        await repository.saveAssets(document.id, parseAssets(html, document.sourceUrl))
      }
      await repository.advanceStage(runId, currentStage, 0n)
    }
    await repository.completeStage(runId, currentStage)

    currentStage = 'DOWNLOADING_ASSETS'
    const assets = await repository.listAssets(runId)
    await repository.startStage(runId, currentStage, assets.length)
    for (const asset of assets) {
      const file = await http.download(asset.sourceUrl, tempDirectory)
      bytes = addWithinLimit(bytes, file.byteSize, maxRunBytes)
      const object = await objectStore.putContent(file)
      await repository.attachAssetObject(asset.id, object)
      await repository.advanceStage(runId, currentStage, file.byteSize)
    }
    await repository.completeStage(runId, currentStage)

    currentStage = 'VALIDATING'
    await repository.startStage(runId, currentStage, 1)
    await repository.verifyManifestCounts(runId)
    await repository.advanceStage(runId, currentStage, 0n)
    await repository.completeStage(runId, currentStage)

    }

    currentStage = 'DISCOVERING_PREVIOUS_SOURCES'
    const previousJobs = await repository.ensurePreviousSourceJobs(runId, {
      model: dependencies.gemini.model,
      promptVersion: PREVIOUS_SOURCE_PROMPT_VERSION,
      configurationHash: PREVIOUS_SOURCE_CONFIGURATION_HASH,
    })
    await repository.startStage(runId, currentStage, previousJobs.length)
    await executePreviousSourceDiscovery(runId, {
      repository,
      aiModel: dependencies.aiModel,
      search: dependencies.previousSourceSearch,
      http,
      objectStore,
      model: dependencies.gemini.model,
      maxAttempts: dependencies.gemini.maxAttempts,
      concurrency: dependencies.gemini.previousSourceConcurrency,
      maxRunBytes,
    })
    const previousProgress = await repository.getPreviousSourceProgress(runId)
    for (let completed = 0; completed < previousProgress.completed; completed += 1) {
      await repository.advanceStage(runId, currentStage, 0n)
    }
    await repository.completeStage(runId, currentStage)

    currentStage = 'WRITING_MANIFEST'
    await repository.startStage(runId, currentStage, 1)
    const manifest = buildManifest(await repository.completedSnapshot(runId))
    const manifestKey = `runs/${datePath}/${runId}/manifest.json`
    const storedManifest = await objectStore.putRunFile(manifestKey, manifest, 'application/json')
    await repository.verifyManifestCounts(runId)
    await repository.advanceStage(runId, currentStage, storedManifest.byteSize)
    await repository.completeStage(runId, currentStage)
    await repository.completeRun(runId, storedManifest.objectKey)
  } catch (error) {
    if (error instanceof AiFilterAwaitingRetryError) return
    if (error instanceof PreviousSourceAwaitingRetryError) {
      await repository.markPreviousSourceStageAwaitingRetry(runId, 'Önceki kaynak hazırlama işlemlerinden bazıları yeniden deneme bekliyor.')
      return
    }
    const message = sanitizeError(error)
    await repository.failStage(runId, currentStage, message).catch(() => undefined)
    const latest = await repository.getExecutionRun(runId)
    await repository.failRun(runId, (latest?.downloadedBytes ?? 0n) > 0n ? 'PARTIAL' : 'FAILED', message)
    throw error
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

async function downloadFirstAvailable(http: OfficialHttp, urls: string[], tempDirectory: string) {
  let lastError: unknown
  for (const url of urls) {
    try {
      return await http.download(url, tempDirectory)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('No official index URL is available')
}

function addWithinLimit(current: bigint, addition: bigint, maximum: bigint): bigint {
  const next = current + addition
  if (next > maximum) throw new Error('Scan exceeds the configured total byte limit')
  return next
}

function sanitizeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1_000) : 'Unknown scan error'
}
