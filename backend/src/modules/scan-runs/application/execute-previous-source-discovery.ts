import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'cheerio'
import type { AiModelClient } from '../../ai/application/ai-model-client'
import { AiProviderError, executeWithAiRetries } from '../../ai/domain/ai-errors'
import type { PrismaScanRepository } from '../infrastructure/prisma-scan-repository'
import { parseAssets } from '../infrastructure/resmi-gazete-parser'
import type { ObjectStore, OfficialHttp, PreviousSourceCandidateRecord, PreviousSourceSearch, PreviousSourceWorkItem, StoredBlob } from './ports'
import { buildPreviousSourcePreflightRequest, PREVIOUS_SOURCE_CONFIGURATION_HASH, PREVIOUS_SOURCE_PROMPT_VERSION } from './previous-source-prompts'
import { selectPreviousSource } from './previous-source-matcher'
import { parsePreviousSourcePreflightResponse, type PreviousSourceIntent } from './previous-source-schemas'

interface Dependencies {
  repository: PrismaScanRepository
  aiModel: AiModelClient
  search: PreviousSourceSearch
  http: OfficialHttp
  objectStore: ObjectStore
  model: string
  maxAttempts: number
  concurrency: number
  maxRunBytes: bigint
}

export class PreviousSourceAwaitingRetryError extends Error {
  override readonly name = 'PreviousSourceAwaitingRetryError'
  constructor(readonly runId: string) {
    super(`Previous source discovery awaits retry for scan run ${runId}`)
  }
}

export async function executePreviousSourceDiscovery(runId: string, dependencies: Dependencies): Promise<void> {
  await dependencies.repository.ensurePreviousSourceJobs(runId, {
    model: dependencies.model,
    promptVersion: PREVIOUS_SOURCE_PROMPT_VERSION,
    configurationHash: PREVIOUS_SOURCE_CONFIGURATION_HASH,
  })
  const work = await dependencies.repository.listPreviousSourceWork(runId)
  if (work.length === 0) return
  const run = await dependencies.repository.getExecutionRun(runId)
  if (!run) throw new Error(`Scan run not found: ${runId}`)
  let reservedBytes = run.downloadedBytes
  const reserve = (bytes: bigint) => {
    const next = reservedBytes + bytes
    if (next > dependencies.maxRunBytes) throw new Error('Scan exceeds the configured total byte limit')
    reservedBytes = next
  }
  let failures = 0
  let cursor = 0
  const worker = async () => {
    while (cursor < work.length) {
      const item = work[cursor++]!
      try {
        await processJob(runId, item, dependencies, reserve)
      } catch (error) {
        failures += 1
        const failure = toFailure(error)
        await dependencies.repository.markPreviousSourceAwaitingRetry(item.id, failure)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, dependencies.concurrency), work.length) }, () => worker()))
  if (failures > 0) throw new PreviousSourceAwaitingRetryError(runId)
}

async function processJob(
  runId: string,
  item: PreviousSourceWorkItem,
  dependencies: Dependencies,
  reserve: (bytes: bigint) => void,
): Promise<void> {
  await dependencies.repository.markPreviousSourceJobRunning(item.id)
  const currentBytes = await dependencies.objectStore.getContent(item.document.storedObject.objectKey)
  const visibleText = item.document.storedObject.mediaType === 'text/html' ? extractVisibleText(currentBytes) : ''
  const built = buildPreviousSourcePreflightRequest({
    documentId: item.documentId,
    title: item.document.title,
    publicationDate: item.document.publicationDate,
    sourceUrl: item.document.sourceUrl,
    documentType: item.document.documentType,
    visibleText,
  }, dependencies.model)
  const intent = await generateIntent(item.id, built.request, dependencies)
  await dependencies.repository.savePreviousSourceIntent(item.id, intent)
  if (!intent.needsPreviousSource) {
    await dependencies.repository.completePreviousSourceOutcome(item.id, 'NOT_REQUIRED')
    return
  }

  const rawCandidates = []
  const seen = new Set<string>()
  for (const query of intent.queryCandidates) {
    for (const candidate of await dependencies.search.search({ query, endDate: dayBefore(item.document.publicationDate), limit: 10 })) {
      if (!seen.has(candidate.url)) {
        seen.add(candidate.url)
        rawCandidates.push(candidate)
      }
    }
  }
  const match = selectPreviousSource({ publicationDate: item.document.publicationDate }, intent, rawCandidates)
  const candidates: PreviousSourceCandidateRecord[] = match.candidates.map((candidate) => ({ ...candidate, selected: false }))
  await dependencies.repository.savePreviousSourceCandidates(item.id, candidates)
  if (match.outcome === 'NOT_FOUND' || match.outcome === 'AMBIGUOUS') {
    await dependencies.repository.completePreviousSourceOutcome(item.id, match.outcome)
    return
  }
  if (!match.selected) throw new Error('Verified previous source match has no selected candidate')

  const sourceUrl = await dependencies.search.resolveDocumentUrl(match.selected, intent)
  const tempDirectory = await mkdtemp(join(tmpdir(), `atez-previous-${runId}-`))
  try {
    const file = await dependencies.http.download(sourceUrl, tempDirectory)
    reserve(file.byteSize)
    const object = await dependencies.objectStore.putContent(file)
    await dependencies.repository.addDownloadedBytes(runId, file.byteSize)
    const assets: Array<{ sourceUrl: string; referenceText?: string; role: 'ATTACHMENT' | 'IMAGE' | 'STYLESHEET_ASSET' | 'OTHER_SUPPORTED'; object: StoredBlob }> = []
    if (file.mediaType === 'text/html') {
      const html = decodeHtml(await readFile(file.tempPath))
      for (const discovered of parseAssets(html, sourceUrl)) {
        const assetFile = await dependencies.http.download(discovered.sourceUrl, tempDirectory)
        reserve(assetFile.byteSize)
        const assetObject = await dependencies.objectStore.putContent(assetFile)
        await dependencies.repository.addDownloadedBytes(runId, assetFile.byteSize)
        assets.push({
          sourceUrl: discovered.sourceUrl,
          ...(discovered.referenceText ? { referenceText: discovered.referenceText } : {}),
          role: discovered.role,
          object: assetObject,
        })
      }
    }
    await dependencies.repository.completePreviousSourceVerified(item.id, {
      candidate: { ...match.selected, documentUrl: sourceUrl, selected: true },
      sourceUrl,
      object,
      assets,
    })
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}

async function generateIntent(jobId: string, request: ReturnType<typeof buildPreviousSourcePreflightRequest>['request'], dependencies: Dependencies): Promise<PreviousSourceIntent> {
  return executeWithAiRetries(async () => {
    const attemptNo = await dependencies.repository.nextPreviousSourceCallAttempt(jobId)
    const inputHash = createHash('sha256').update(JSON.stringify(request.parts)).digest('hex')
    const call = await dependencies.repository.startPreviousSourceCall({ jobId, attemptNo, inputHash })
    const startedAt = Date.now()
    try {
      const result = await dependencies.aiModel.generateStructured(request)
      let parsed: PreviousSourceIntent
      try {
        parsed = parsePreviousSourcePreflightResponse(result.json)
      } catch {
        throw new AiProviderError('INVALID_RESPONSE', true, 'Gemini geçerli bir önceki kaynak arama yanıtı döndürmedi.')
      }
      await dependencies.repository.completePreviousSourceCall(call.id, {
        providerRequestId: result.providerRequestId,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        latencyMs: Date.now() - startedAt,
      })
      return parsed
    } catch (error) {
      const failure = toFailure(error)
      await dependencies.repository.failPreviousSourceCall(call.id, failure)
      throw error
    }
  }, { maxAttempts: dependencies.maxAttempts })
}

function extractVisibleText(bytes: Buffer): string {
  const html = decodeHtml(bytes)
  const $ = load(html)
  $('script, style, nav, header, footer, aside, noscript, xml').remove()
  $('br').replaceWith('\n')
  $('h1, h2, h3, h4, h5, h6, p, li, tr').each((_index, element) => { $(element).append('\n') })
  return $('body').text().replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function decodeHtml(bytes: Buffer): string {
  const head = bytes.subarray(0, Math.min(bytes.length, 2_000)).toString('latin1')
  const windowsTurkish = /charset\s*=\s*["']?windows-1254/i.test(head)
  return new TextDecoder(windowsTurkish ? 'windows-1254' : 'utf-8').decode(bytes)
}

function dayBefore(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() - 1)
  return value.toISOString().slice(0, 10)
}

function toFailure(error: unknown): { category: 'AUTHENTICATION' | 'PERMISSION' | 'QUOTA_EXCEEDED' | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'TIMEOUT' | 'INVALID_RESPONSE' | 'CONTENT_REJECTED' | 'UNKNOWN_PROVIDER_ERROR'; providerStatus: number | null; message: string } {
  if (error instanceof AiProviderError) return { category: error.category, providerStatus: error.providerStatus, message: error.message }
  return { category: 'UNKNOWN_PROVIDER_ERROR', providerStatus: null, message: error instanceof Error ? error.message.slice(0, 1_000) : 'Önceki kaynak hazırlama işlemi başarısız oldu.' }
}
