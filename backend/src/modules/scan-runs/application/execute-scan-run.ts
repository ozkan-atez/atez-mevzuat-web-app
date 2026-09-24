import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ObjectStore, OfficialHttp, PreviousSourceSearch } from './ports'
import type { AiModelClient } from '../../ai/application/ai-model-client'
import type { PrismaScanRepository } from '../infrastructure/prisma-scan-repository'
import { candidateIndexUrls, parseAssets, parseEditions } from '../infrastructure/resmi-gazete-parser'
import { buildManifest } from './build-manifest'
import { scanStages, type ScanStage } from '../domain/scan-run'
import { AiFilterAwaitingRetryError, AiFilterFailedError, executeDocumentFilter } from './execute-document-filter'
import { executePreviousSourceDiscovery, PreviousSourceAwaitingRetryError, PreviousSourceFailedError } from './execute-previous-source-discovery'
import { PREVIOUS_SOURCE_CONFIGURATION_HASH, PREVIOUS_SOURCE_PROMPT_VERSION } from './previous-source-prompts'
import type { PrismaTopicAnalysisRepository } from '../../topic-analysis/infrastructure/prisma-topic-analysis-repository'
import { executeTopicAnalysis } from '../../topic-analysis/application/execute-topic-analysis'
import { executeRunTopicAnalyses } from '../../topic-analysis/application/execute-run-topic-analyses'
import type { SelectedSourceResult } from '../../managed-sources/run-selected-sources'

interface Dependencies {
  repository: PrismaScanRepository
  http: OfficialHttp
  objectStore: ObjectStore
  maxRunBytes: bigint
  aiModel: AiModelClient
  previousSourceSearch: PreviousSourceSearch
  topicRepository: PrismaTopicAnalysisRepository
  sourceRunner?: (runId: string) => Promise<SelectedSourceResult[]>
  duplicateChecker?: (runId: string) => Promise<void>
  gemini: { model: string; maxAttempts: number; maxContentBytes: number; previousSourceConcurrency: number; topicConcurrency: number }
}

export async function executeScanRun(
  runId: string,
  dependencies: Dependencies,
  command: 'START_SCAN' | 'RETRY_AI_FILTER' | 'RETRY_PREVIOUS_SOURCES' = 'START_SCAN',
  options: { resumeStalled?: boolean } = {},
): Promise<void> {
  const { repository, http, objectStore, maxRunBytes } = dependencies
  const run = await repository.getExecutionRun(runId)
  if (!run) throw new Error(`Scan run not found: ${runId}`)
  // RUNNING normally means another worker holds this run. It also means a worker
  // died holding it, and the queue only redelivers the job once it decides that
  // worker is gone — so on a redelivery, RUNNING is ours to take over. Without
  // this the redelivery returned silently and the run hung in its stage forever.
  const takeOver = options.resumeStalled === true && run.status === 'RUNNING'
  const blocked = takeOver ? ['AWAITING_RETRY', 'COMPLETED', 'CANCELLED'] : ['RUNNING', 'AWAITING_RETRY', 'COMPLETED', 'CANCELLED']
  if (command === 'START_SCAN' && blocked.includes(run.status)) return
  const completedStages = new Set(run.stages.filter((stage) => stage.status === 'COMPLETED').map((stage) => stage.stage))
  const resumeStage: ScanStage = command === 'RETRY_AI_FILTER'
    ? 'AI_FILTERING'
    : command === 'RETRY_PREVIOUS_SOURCES'
      ? 'DISCOVERING_PREVIOUS_SOURCES'
      : scanStages.find((stage) => !completedStages.has(stage)) ?? 'WRITING_MANIFEST'
  const shouldRun = (stage: ScanStage) => scanStages.indexOf(stage) >= scanStages.indexOf(resumeStage)
  const tempDirectory = await mkdtemp(join(tmpdir(), `atez-scan-${runId}-`))
  let currentStage: ScanStage = resumeStage
  let bytes = run.downloadedBytes

  try {
    await objectStore.ensureBucket()
    await repository.startRun(runId)
    const selectedKeys = run.sourceKeys ?? ['resmi-gazete']
    const hasGazette = selectedKeys.includes('resmi-gazete')
    let sourceResults: SelectedSourceResult[] = []
    if (selectedKeys.some((key) => key !== 'resmi-gazete')) {
      currentStage = 'DISCOVERING'
      if (!dependencies.sourceRunner) throw new Error('Seçili kaynak tarayıcısı yapılandırılmamış.')
      if (!hasGazette) await repository.startStage(runId, 'DISCOVERING', selectedKeys.length)
      sourceResults = await dependencies.sourceRunner(runId)
      if (!hasGazette) {
        for (const _result of sourceResults) await repository.advanceStage(runId, 'DISCOVERING', 0n)
        await repository.completeStage(runId, 'DISCOVERING')
      }
    }
    if (!hasGazette) {
      await completeSourceOnlyRun(runId, run.targetDate, sourceResults, { repository, objectStore, ...(dependencies.duplicateChecker ? { duplicateChecker: dependencies.duplicateChecker } : {}) })
      return
    }
    const datePath = run.targetDate.replaceAll('-', '/')
    if (shouldRun('DISCOVERING')) {
      currentStage = 'DISCOVERING'
      await repository.startStage(runId, currentStage, 1)
      let indexBytes: Buffer
      let indexSourceUrl: string
      let downloadedIndexBytes = 0n

      if (run.indexObjectKey) {
        if (!run.indexSourceUrl) throw new Error('Archived index source URL is missing')
        indexBytes = await objectStore.getContent(run.indexObjectKey)
        indexSourceUrl = run.indexSourceUrl
      } else {
        const indexFile = await downloadFirstAvailable(http, candidateIndexUrls(run.targetDate), tempDirectory)
        bytes = addWithinLimit(bytes, indexFile.byteSize, maxRunBytes)
        const indexKey = `runs/${datePath}/${runId}/index.html`
        indexBytes = await readFile(indexFile.tempPath)
        indexSourceUrl = indexFile.sourceUrl
        downloadedIndexBytes = indexFile.byteSize
        const storedIndex = await objectStore.putRunFile(indexKey, indexBytes, 'text/html')
        await repository.saveIndex(runId, indexSourceUrl, storedIndex)
      }

      const editions = parseEditions(indexBytes.toString('utf8'), indexSourceUrl, run.targetDate)
      if (editions.length === 0) throw new Error('No official publications were discovered for the selected date')
      await repository.saveEditions(runId, run.targetDate, editions)
      await repository.advanceStage(runId, currentStage, downloadedIndexBytes)
      await repository.completeStage(runId, currentStage)
    }

    if (shouldRun('AI_FILTERING')) {
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
    // A completed filter job can be reused after a crash before the stage was marked complete.
    await repository.completeStage(runId, currentStage)
    bytes = (await repository.getExecutionRun(runId))?.downloadedBytes ?? bytes

    }

    if (shouldRun('DOWNLOADING_DOCUMENTS')) {
    currentStage = 'DOWNLOADING_DOCUMENTS'
    const documents = await repository.listFilterDocuments(runId)
    await repository.startStage(runId, currentStage, documents.length)
    for (const document of documents) {
      if (document.storedObject) {
        await repository.advanceStage(runId, currentStage, 0n)
        continue
      }
      const file = await http.download(document.sourceUrl, tempDirectory)
      bytes = addWithinLimit(bytes, file.byteSize, maxRunBytes)
      const object = await objectStore.putContent(file)
      await repository.attachDocumentObject(document.id, object)
      await repository.advanceStage(runId, currentStage, file.byteSize)
    }
    await repository.completeStage(runId, currentStage)
    }

    if (shouldRun('DISCOVERING_ASSETS')) {
    currentStage = 'DISCOVERING_ASSETS'
    const documents = await repository.listFilterDocuments(runId)
    await repository.startStage(runId, currentStage, documents.length)
    for (const document of documents) {
      if (!document.storedObject) throw new Error(`Document object missing: ${document.id}`)
      if (document.storedObject.mediaType === 'text/html') {
        const html = (await objectStore.getContent(document.storedObject.objectKey)).toString('utf8')
        await repository.saveAssets(document.id, parseAssets(html, document.sourceUrl))
      }
      await repository.advanceStage(runId, currentStage, 0n)
    }
    await repository.completeStage(runId, currentStage)
    }

    if (shouldRun('DOWNLOADING_ASSETS')) {
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
    }

    if (shouldRun('VALIDATING')) {
    currentStage = 'VALIDATING'
    await repository.startStage(runId, currentStage, 1)
    await repository.verifyManifestCounts(runId)
    await repository.advanceStage(runId, currentStage, 0n)
    await repository.completeStage(runId, currentStage)
    }

    if (shouldRun('DISCOVERING_PREVIOUS_SOURCES')) {
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
    }

    if (shouldRun('GENERATING_REPORTS')) {
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
        analysisStarted: async (total) => { if (shouldRun('ANALYZING_TOPICS')) { currentStage = 'ANALYZING_TOPICS'; await repository.startStage(runId, currentStage, total) } },
        analysisItemFinished: async () => { if (shouldRun('ANALYZING_TOPICS')) await repository.advanceStage(runId, 'ANALYZING_TOPICS', 0n) },
        analysisFinished: async () => { if (shouldRun('ANALYZING_TOPICS')) await repository.completeStage(runId, 'ANALYZING_TOPICS') },
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
      const cause = analysisResult.failures[0]?.message
      const state = analysisResult.status === 'PARTIAL' ? 'kısmen tamamlandı' : 'tamamlanamadı'
      throw new Error(`Analiz ve raporlama ${state}. ${analysisResult.failures.length} belge işlenemedi.${cause ? ` Neden: ${cause}` : ''}`)
    }
    await dependencies.duplicateChecker?.(runId)
    }

    if (shouldRun('WRITING_MANIFEST')) {
    currentStage = 'WRITING_MANIFEST'
    await finalizeScanRun(runId, { repository, objectStore })
    const failedSources = sourceResults.filter((result) => result.status !== 'COMPLETED')
    if (failedSources.length) await repository.failRun(runId, 'PARTIAL', `${failedSources.length} seçili kaynak tamamlanamadı: ${failedSources.map((result) => result.sourceName).join(', ')}`)
    }
  } catch (error) {
    if (error instanceof AiFilterAwaitingRetryError || error instanceof AiFilterFailedError) return
    if (error instanceof PreviousSourceAwaitingRetryError) {
      await repository.markPreviousSourceStageAwaitingRetry(runId, 'Önceki kaynak hazırlama işlemlerinden bazıları yeniden deneme bekliyor.')
      return
    }
    if (error instanceof PreviousSourceFailedError) {
      await repository.markPreviousSourceStageFailed(runId, 'Önceki kaynak hazırlama işlemlerinden biri tekrar denenemeyen bir hatayla sonuçlandı.')
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

async function completeSourceOnlyRun(runId: string, targetDate: string, results: SelectedSourceResult[], dependencies: Pick<Dependencies, 'repository' | 'objectStore' | 'duplicateChecker'>): Promise<void> {
  const { repository, objectStore } = dependencies
  await repository.startStage(runId, 'VALIDATING', results.length)
  for (const _result of results) await repository.advanceStage(runId, 'VALIDATING', 0n)
  await repository.completeStage(runId, 'VALIDATING')
  await repository.startStage(runId, 'GENERATING_REPORTS', results.length)
  for (const _result of results) await repository.advanceStage(runId, 'GENERATING_REPORTS', 0n)
  await repository.completeStage(runId, 'GENERATING_REPORTS')
  await dependencies.duplicateChecker?.(runId)
  await repository.startStage(runId, 'WRITING_MANIFEST', 1)
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, runId, targetDate, sources: results }, null, 2))
  const stored = await objectStore.putRunFile(`runs/${targetDate.replaceAll('-', '/')}/${runId}/manifest.json`, manifest, 'application/json')
  await repository.advanceStage(runId, 'WRITING_MANIFEST', 0n)
  await repository.completeStage(runId, 'WRITING_MANIFEST')
  if (results.every((result) => result.status === 'COMPLETED')) await repository.completeRun(runId, stored.objectKey)
  else await repository.failRun(runId, results.some((result) => result.status === 'COMPLETED') ? 'PARTIAL' : 'FAILED', `Seçili kaynaklar tamamlanamadı: ${results.filter((result) => result.status !== 'COMPLETED').map((result) => result.sourceName).join(', ')}`)
}

export async function resumeRunAfterTopicRetry(
  runId: string,
  dependencies: Pick<Dependencies, 'repository' | 'topicRepository' | 'objectStore'>,
): Promise<boolean> {
  if (!(await dependencies.topicRepository.canFinalizeRunAfterTopicRetry(runId))) return false
  const run = await dependencies.repository.getExecutionRun(runId)
  if (!run) throw new Error(`Scan run not found: ${runId}`)
  const manifest = buildManifest(await dependencies.repository.completedSnapshot(runId))
  const manifestKey = `runs/${run.targetDate.replaceAll('-', '/')}/${runId}/manifest.json`
  const storedManifest = await dependencies.objectStore.putRunFile(manifestKey, manifest, 'application/json')
  await dependencies.repository.verifyManifestCounts(runId)
  const completed = await dependencies.repository.completeRunAfterTopicRetry(runId, storedManifest.objectKey)
  if (completed) {
    const sourceResults = (await dependencies.repository.getRun(runId))?.sourceResults ?? []
    const failedSources = sourceResults.filter((source) => source.status !== 'COMPLETED')
    if (failedSources.length) await dependencies.repository.failRun(runId, 'PARTIAL', `${failedSources.length} seçili kaynak tamamlanamadı: ${failedSources.map((source) => source.sourceName).join(', ')}`)
  }
  return completed
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
