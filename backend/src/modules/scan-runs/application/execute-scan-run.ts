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
import type { PrismaTopicAnalysisRepository } from '../../topic-analysis/infrastructure/prisma-topic-analysis-repository'
import { executeTopicAnalysis } from '../../topic-analysis/application/execute-topic-analysis'
import { executeRunTopicAnalyses } from '../../topic-analysis/application/execute-run-topic-analyses'

interface Dependencies {
  repository: PrismaScanRepository
  http: OfficialHttp
  objectStore: ObjectStore
  maxRunBytes: bigint
  aiModel: AiModelClient
  previousSourceSearch: PreviousSourceSearch
  topicRepository: PrismaTopicAnalysisRepository
  gemini: { model: string; maxAttempts: number; maxContentBytes: number; previousSourceConcurrency: number; topicConcurrency: number }
}

export async function executeScanRun(runId: string, dependencies: Dependencies, command: 'START_SCAN' | 'RETRY_AI_FILTER' | 'RETRY_PREVIOUS_SOURCES' = 'START_SCAN'): Promise<void> {
  const { repository, http, objectStore, maxRunBytes } = dependencies
  const run = await repository.getExecutionRun(runId)
  if (!run) throw new Error(`Scan run not found: ${runId}`)
  if (command === 'START_SCAN' && ['RUNNING', 'AWAITING_RETRY', 'COMPLETED', 'CANCELLED'].includes(run.status)) return
  const tempDirectory = await mkdtemp(join(tmpdir(), `atez-scan-${runId}-`))
  let currentStage: ScanStage = 'DISCOVERING'
  let bytes = run.downloadedBytes

  try {
    await objectStore.ensureBucket()
    const datePath = run.targetDate.replaceAll('-', '/')
    if (command === 'START_SCAN') {
      await repository.startRun(runId)
      if (!run.indexObjectKey) {
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
      if (asset.storedObject) {
        await repository.advanceStage(runId, currentStage, 0n)
        continue
      }
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

    const analysisResult = await executeRunTopicAnalyses(runId, {
      repository: dependencies.topicRepository,
      objectStore,
      concurrency: dependencies.gemini.topicConcurrency,
      executeTopic: (topicId) => executeTopicAnalysis(topicId, {
        repository: dependencies.topicRepository,
        objectStore,
        aiModel: dependencies.aiModel,
        model: dependencies.gemini.model,
        maxAttempts: dependencies.gemini.maxAttempts,
        maxContextBytes: dependencies.gemini.maxContentBytes,
      }),
      lifecycle: {
        analysisStarted: async (total) => { currentStage = 'ANALYZING_TOPICS'; await repository.startStage(runId, currentStage, total) },
        analysisItemFinished: () => repository.advanceStage(runId, 'ANALYZING_TOPICS', 0n),
        analysisFinished: () => repository.completeStage(runId, 'ANALYZING_TOPICS'),
        reportsStarted: async (total) => { currentStage = 'GENERATING_REPORTS'; await repository.startStage(runId, currentStage, total) },
        reportItemFinished: () => repository.advanceStage(runId, 'GENERATING_REPORTS', 0n),
        reportsFinished: () => repository.completeStage(runId, 'GENERATING_REPORTS'),
      },
    })
    if (analysisResult.status === 'AWAITING_RETRY') {
      await repository.markTopicAnalysisAwaitingRetry(runId, analysisResult.counts)
      return
    }
    if (analysisResult.status === 'PARTIAL' || analysisResult.status === 'FAILED') {
      throw new Error(`Topic analizi ve raporlama ${analysisResult.status.toLocaleLowerCase('tr-TR')} tamamlandı.`)
    }

    currentStage = 'WRITING_MANIFEST'
    await finalizeScanRun(runId, { repository, objectStore })
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

export async function resumeRunAfterTopicRetry(
  runId: string,
  dependencies: Pick<Dependencies, 'repository' | 'topicRepository' | 'objectStore'>,
): Promise<boolean> {
  if (!(await dependencies.topicRepository.canFinalizeRunAfterTopicRetry(runId))) return false
  await finalizeScanRun(runId, dependencies)
  return true
}

export async function finalizeScanRun(
  runId: string,
  dependencies: Pick<Dependencies, 'repository' | 'objectStore'>,
): Promise<void> {
  const run = await dependencies.repository.getExecutionRun(runId)
  if (!run) throw new Error(`Scan run not found: ${runId}`)
  await dependencies.repository.startStage(runId, 'WRITING_MANIFEST', 1)
  const manifest = buildManifest(await dependencies.repository.completedSnapshot(runId))
  const manifestKey = `runs/${run.targetDate.replaceAll('-', '/')}/${runId}/manifest.json`
  const storedManifest = await dependencies.objectStore.putRunFile(manifestKey, manifest, 'application/json')
  await dependencies.repository.verifyManifestCounts(runId)
  await dependencies.repository.advanceStage(runId, 'WRITING_MANIFEST', 0n)
  await dependencies.repository.completeStage(runId, 'WRITING_MANIFEST')
  await dependencies.repository.completeRun(runId, storedManifest.objectKey)
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
