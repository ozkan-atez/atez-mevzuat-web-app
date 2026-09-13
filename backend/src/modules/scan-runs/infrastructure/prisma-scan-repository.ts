import type { Prisma, PrismaClient } from '@prisma/client'
import type { ScanRunStatus, ScanStage } from '../domain/scan-run'
import type {
  AiCallCompletion,
  AiCallFailure,
  AiCallRecord,
  AiJobRecord,
  CompletedRunSnapshot,
  ContentDecision,
  DiscoveredAsset,
  DiscoveredEdition,
  FilterConfiguration,
  FilterDocumentRecord,
  FilterProgress,
  ScanRunDetailDto,
  ScanRunSummaryDto,
  StartAiCallInput,
  StoredBlob,
  TitleDecision,
} from '../application/ports'

export class PrismaScanRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createManualRun(input: { requestKey: string; targetDate: string }): Promise<{
    id: string
    status: ScanRunStatus
    targetDate: string
  }> {
    const run = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.scanRun.findUnique({ where: { requestKey: input.requestKey } })
      if (existing) return existing

      return tx.scanRun.create({
        data: {
          requestKey: input.requestKey,
          targetDate: new Date(`${input.targetDate}T00:00:00.000Z`),
          timezone: 'Europe/Istanbul',
          outbox: { create: { requestKey: input.requestKey } },
        },
      })
    })

    return {
      id: run.id,
      status: run.status,
      targetDate: run.targetDate.toISOString().slice(0, 10),
    }
  }

  async claimPendingOutbox(limit: number): Promise<Array<{ id: string; scanRunId: string; commandType: 'START_SCAN' | 'RETRY_AI_FILTER'; attempts: number }>> {
    return this.prisma.scanOutbox.findMany({
      where: { dispatchedAt: null, availableAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, scanRunId: true, commandType: true, attempts: true },
    })
  }

  async markOutboxDispatched(outboxId: string, queueJobId: string): Promise<void> {
    const outbox = await this.prisma.scanOutbox.findUniqueOrThrow({ where: { id: outboxId } })
    await this.prisma.$transaction([
      this.prisma.scanOutbox.update({
        where: { id: outboxId },
        data: { dispatchedAt: new Date(), lastError: null },
      }),
      this.prisma.scanRun.update({
        where: { id: outbox.scanRunId },
        data: { queueJobId },
      }),
    ])
  }

  async deferOutbox(outboxId: string, error: string, availableAt: Date): Promise<void> {
    await this.prisma.scanOutbox.update({
      where: { id: outboxId },
      data: { attempts: { increment: 1 }, lastError: error, availableAt },
    })
  }

  async getExecutionRun(runId: string): Promise<{ id: string; targetDate: string; downloadedBytes: bigint } | null> {
    const run = await this.prisma.scanRun.findUnique({ where: { id: runId } })
    return run ? { id: run.id, targetDate: run.targetDate.toISOString().slice(0, 10), downloadedBytes: run.downloadedBytes } : null
  }

  async startRun(runId: string): Promise<void> {
    await this.prisma.scanRun.update({ where: { id: runId }, data: { status: 'RUNNING', startedAt: new Date(), errorSummary: null } })
  }

  async startStage(runId: string, stage: ScanStage, totalItems: number): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.scanRun.update({ where: { id: runId }, data: { currentStage: stage, totalItems, completedItems: 0, failedItems: 0 } }),
      this.prisma.stageExecution.upsert({
        where: { scanRunId_stage: { scanRunId: runId, stage } },
        create: { scanRunId: runId, stage, status: 'RUNNING', totalItems, startedAt: new Date() },
        update: { status: 'RUNNING', totalItems, completedItems: 0, failedItems: 0, startedAt: new Date(), completedAt: null, errorSummary: null },
      }),
    ])
  }

  async advanceStage(runId: string, stage: ScanStage, downloadedBytes: bigint): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.scanRun.update({ where: { id: runId }, data: { completedItems: { increment: 1 }, downloadedBytes: { increment: downloadedBytes } } }),
      this.prisma.stageExecution.update({ where: { scanRunId_stage: { scanRunId: runId, stage } }, data: { completedItems: { increment: 1 } } }),
    ])
  }

  async completeStage(runId: string, stage: ScanStage): Promise<void> {
    await this.prisma.stageExecution.update({ where: { scanRunId_stage: { scanRunId: runId, stage } }, data: { status: 'COMPLETED', completedAt: new Date() } })
  }

  async failStage(runId: string, stage: ScanStage, error: string): Promise<void> {
    await this.prisma.stageExecution.update({ where: { scanRunId_stage: { scanRunId: runId, stage } }, data: { status: 'FAILED', failedItems: { increment: 1 }, errorSummary: error, completedAt: new Date() } })
  }

  async saveIndex(runId: string, sourceUrl: string, object: StoredBlob): Promise<void> {
    await this.prisma.scanRun.update({ where: { id: runId }, data: { indexSourceUrl: sourceUrl, indexObjectKey: object.objectKey, indexSha256: object.sha256 } })
  }

  async saveEditions(runId: string, targetDate: string, editions: DiscoveredEdition[]): Promise<void> {
    await this.prisma.$transaction(editions.map((edition) => this.prisma.gazetteEdition.create({
      data: {
        scanRunId: runId,
        publicationDate: new Date(`${targetDate}T00:00:00.000Z`),
        type: edition.type,
        supplementNo: edition.supplementNo,
        indexUrl: edition.indexUrl,
        discoveryOrder: edition.discoveryOrder,
        documents: { create: edition.documents.map((document) => ({
          title: document.title,
          documentType: document.documentType ?? null,
          sourceUrl: document.sourceUrl,
          publicationOrder: document.publicationOrder,
        })) },
      },
    })))
  }

  async listDocuments(runId: string): Promise<Array<{ id: string; sourceUrl: string; title: string }>> {
    return this.prisma.collectedDocument.findMany({
      where: { edition: { scanRunId: runId } }, orderBy: [{ edition: { discoveryOrder: 'asc' } }, { publicationOrder: 'asc' }],
      select: { id: true, sourceUrl: true, title: true },
    })
  }

  async saveAssets(documentId: string, assets: DiscoveredAsset[]): Promise<void> {
    if (assets.length === 0) return
    await this.prisma.documentAsset.createMany({
      data: assets.map((asset) => ({ documentId, sourceUrl: asset.sourceUrl, role: asset.role, referenceText: asset.referenceText ?? null })),
      skipDuplicates: true,
    })
  }

  async listAssets(runId: string): Promise<Array<{ id: string; documentId: string; sourceUrl: string }>> {
    return this.prisma.documentAsset.findMany({
      where: { document: { edition: { scanRunId: runId } } }, orderBy: { sourceUrl: 'asc' },
      select: { id: true, documentId: true, sourceUrl: true },
    })
  }

  async attachDocumentObject(documentId: string, object: StoredBlob): Promise<void> {
    const storedObjectId = await this.upsertObject(object)
    await this.prisma.collectedDocument.update({ where: { id: documentId }, data: { storedObjectId, validationStatus: 'VALID' } })
  }

  async attachAssetObject(assetId: string, object: StoredBlob): Promise<void> {
    const storedObjectId = await this.upsertObject(object)
    await this.prisma.documentAsset.update({ where: { id: assetId }, data: { storedObjectId, validationStatus: 'VALID' } })
  }

  async verifyManifestCounts(runId: string): Promise<void> {
    const [documents, invalidDocuments, assets, invalidAssets] = await Promise.all([
      this.prisma.collectedDocument.count({ where: { edition: { scanRunId: runId } } }),
      this.prisma.collectedDocument.count({ where: { edition: { scanRunId: runId }, validationStatus: { not: 'VALID' } } }),
      this.prisma.documentAsset.count({ where: { document: { edition: { scanRunId: runId } } } }),
      this.prisma.documentAsset.count({ where: { document: { edition: { scanRunId: runId } }, validationStatus: { not: 'VALID' } } }),
    ])
    if (documents === 0 || invalidDocuments > 0 || invalidAssets > 0) {
      throw new Error(`Manifest verification failed: documents=${documents}, invalidDocuments=${invalidDocuments}, assets=${assets}, invalidAssets=${invalidAssets}`)
    }
  }

  async completeRun(runId: string, manifestObjectKey: string): Promise<void> {
    await this.prisma.scanRun.update({ where: { id: runId }, data: { status: 'COMPLETED', manifestObjectKey, completedAt: new Date() } })
  }

  async failRun(runId: string, status: 'PARTIAL' | 'FAILED', error: string): Promise<void> {
    await this.prisma.scanRun.update({ where: { id: runId }, data: { status, errorSummary: error, completedAt: new Date() } })
  }

  async getRun(runId: string): Promise<ScanRunDetailDto | null> {
    const run = await this.prisma.scanRun.findUnique({
      where: { id: runId },
      include: {
        stages: { orderBy: { createdAt: 'asc' } },
        aiJobs: { where: { kind: 'DOCUMENT_FILTER' }, include: { decisions: true } },
        editions: { orderBy: { discoveryOrder: 'asc' }, include: { documents: { orderBy: { publicationOrder: 'asc' }, include: { _count: { select: { assets: true } } } } } },
      },
    })
    if (!run) return null
    const assets = await this.prisma.documentAsset.count({ where: { document: { edition: { scanRunId: runId } } } })
    const filterJob = run.aiJobs[0] ?? null
    const filterDecisions = new Map(filterJob?.decisions.map((decision) => [decision.documentId, decision]) ?? [])
    const finalIn = filterJob?.decisions.filter((decision) => decision.finalDecision === 'IN').length ?? 0
    const finalOut = filterJob?.decisions.filter((decision) => decision.finalDecision === 'OUT').length ?? 0
    const documentCount = run.editions.reduce((count, edition) => count + edition.documents.length, 0)
    return {
      id: run.id, status: run.status, currentStage: run.currentStage,
      targetDate: run.targetDate.toISOString().slice(0, 10), startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null, errorSummary: run.errorSummary,
      filter: filterJob ? {
        status: filterJob.status,
        counts: { in: finalIn, out: finalOut, pending: Math.max(0, documentCount - finalIn - finalOut) },
        retryAvailable: filterJob.status === 'AWAITING_RETRY',
        errorCategory: filterJob.lastErrorCategory,
        errorMessage: filterJob.lastErrorMessage,
      } : null,
      counts: { editions: run.editions.length, documents: run.editions.reduce((n, e) => n + e.documents.length, 0), assets, completedItems: run.completedItems, totalItems: run.totalItems, failedItems: run.failedItems },
      stages: run.stages.map((stage) => ({ stage: stage.stage, status: stage.status, completedItems: stage.completedItems, totalItems: stage.totalItems, failedItems: stage.failedItems })),
      editions: run.editions.map((edition) => ({
        id: edition.id, type: edition.type, supplementNo: edition.supplementNo,
        documents: edition.documents.map((document) => {
          const decision = filterDecisions.get(document.id)
          return {
            id: document.id, title: document.title, sourceUrl: document.sourceUrl,
            validationStatus: document.validationStatus, assetCount: document._count.assets,
            filter: decision ? {
              titleDecision: decision.titleDecision,
              finalDecision: decision.finalDecision,
              reason: decision.contentReason ?? decision.titleReason,
            } : null,
          }
        }),
      })),
    }
  }

  async listRuns(limit: number): Promise<ScanRunSummaryDto[]> {
    const runs = await this.prisma.scanRun.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: { editions: { include: { documents: { include: { _count: { select: { assets: true } } } } } } },
    })
    return runs.map((run) => ({
      id: run.id,
      trigger: run.trigger,
      status: run.status,
      currentStage: run.currentStage,
      targetDate: run.targetDate.toISOString().slice(0, 10),
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      counts: {
        editions: run.editions.length,
        documents: run.editions.reduce((total, edition) => total + edition.documents.length, 0),
        assets: run.editions.reduce((total, edition) => total + edition.documents.reduce((documentTotal, document) => documentTotal + document._count.assets, 0), 0),
      },
    }))
  }

  async getOrCreateDocumentFilterJob(runId: string, configuration: FilterConfiguration): Promise<AiJobRecord> {
    const job = await this.prisma.aiJob.upsert({
      where: { scanRunId_kind: { scanRunId: runId, kind: 'DOCUMENT_FILTER' } },
      create: {
        scanRunId: runId,
        kind: 'DOCUMENT_FILTER',
        model: configuration.model,
        titlePromptVersion: configuration.titlePromptVersion,
        contentPromptVersion: configuration.contentPromptVersion,
        configurationHash: configuration.configurationHash,
      },
      update: {},
    })
    return {
      id: job.id,
      status: job.status,
      configuration: {
        model: job.model,
        titlePromptVersion: job.titlePromptVersion,
        contentPromptVersion: job.contentPromptVersion,
        configurationHash: job.configurationHash,
      },
    }
  }

  async listFilterDocuments(runId: string): Promise<FilterDocumentRecord[]> {
    const documents = await this.prisma.collectedDocument.findMany({
      where: { edition: { scanRunId: runId } },
      orderBy: [{ edition: { discoveryOrder: 'asc' } }, { publicationOrder: 'asc' }],
      include: { edition: true, storedObject: true },
    })
    return documents.map((document) => ({
      id: document.id,
      title: document.title,
      sourceUrl: document.sourceUrl,
      publicationOrder: document.publicationOrder,
      editionLabel: document.edition.type === 'MAIN' ? 'Ana Sayı' : `${document.edition.supplementNo ?? ''}. Mükerrer Sayı`,
      storedObject: document.storedObject ? {
        objectKey: document.storedObject.objectKey,
        sha256: document.storedObject.sha256,
        mediaType: document.storedObject.mediaType,
        byteSize: document.storedObject.byteSize,
      } : null,
    }))
  }

  async startAiCall(input: StartAiCallInput): Promise<AiCallRecord> {
    const call = await this.prisma.aiCall.create({ data: input, select: { id: true } })
    return call
  }

  async completeAiCall(callId: string, result: AiCallCompletion): Promise<void> {
    await this.prisma.aiCall.update({
      where: { id: callId },
      data: {
        status: 'COMPLETED',
        providerRequestId: result.providerRequestId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
        completedAt: new Date(),
        errorCategory: null,
        providerStatus: null,
        errorMessage: null,
      },
    })
  }

  async failAiCall(callId: string, error: AiCallFailure): Promise<void> {
    await this.prisma.aiCall.update({
      where: { id: callId },
      data: {
        status: 'FAILED',
        errorCategory: error.category,
        providerStatus: error.providerStatus,
        errorMessage: error.message.slice(0, 1_000),
        completedAt: new Date(),
      },
    })
  }

  async saveTitleDecisions(jobId: string, decisions: TitleDecision[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const job = await tx.aiJob.findUniqueOrThrow({ where: { id: jobId } })
      const uniqueIds = [...new Set(decisions.map((decision) => decision.documentId))]
      if (uniqueIds.length !== decisions.length) throw new Error('Title decisions contain duplicate document IDs')
      const ownedCount = await tx.collectedDocument.count({ where: { id: { in: uniqueIds }, edition: { scanRunId: job.scanRunId } } })
      if (ownedCount !== uniqueIds.length) throw new Error('One or more title decisions do not belong to the scan run')
      for (const decision of decisions) {
        await tx.documentFilterDecision.upsert({
          where: { aiJobId_documentId: { aiJobId: jobId, documentId: decision.documentId } },
          create: {
            aiJobId: jobId,
            documentId: decision.documentId,
            titleDecision: decision.decision,
            titleReason: decision.reason,
            titleConfidence: decision.confidence,
            finalDecision: decision.decision === 'MAYBE' ? null : decision.decision,
          },
          update: {
            titleDecision: decision.decision,
            titleReason: decision.reason,
            titleConfidence: decision.confidence,
            contentDecision: null,
            contentReason: null,
            contentConfidence: null,
            finalDecision: decision.decision === 'MAYBE' ? null : decision.decision,
          },
        })
      }
      await this.syncFilterStageProgress(tx, job.scanRunId, jobId)
    })
  }

  async saveContentDecisions(jobId: string, _batchKey: string, decisions: ContentDecision[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const job = await tx.aiJob.findUniqueOrThrow({ where: { id: jobId } })
      const uniqueIds = [...new Set(decisions.map((decision) => decision.documentId))]
      if (uniqueIds.length !== decisions.length) throw new Error('Content decisions contain duplicate document IDs')
      const existing = await tx.documentFilterDecision.findMany({ where: { aiJobId: jobId, documentId: { in: uniqueIds } } })
      if (existing.length !== uniqueIds.length || existing.some((decision) => decision.titleDecision !== 'MAYBE')) {
        throw new Error('Content decisions must belong to MAYBE documents in the scan run')
      }
      for (const decision of decisions) {
        await tx.documentFilterDecision.update({
          where: { aiJobId_documentId: { aiJobId: jobId, documentId: decision.documentId } },
          data: {
            contentDecision: decision.decision,
            contentReason: decision.reason,
            contentConfidence: decision.confidence,
            finalDecision: decision.decision,
          },
        })
      }
      await this.syncFilterStageProgress(tx, job.scanRunId, jobId)
    })
  }

  async getFilterProgress(jobId: string): Promise<FilterProgress> {
    const job = await this.prisma.aiJob.findUniqueOrThrow({ where: { id: jobId } })
    const [documentCount, decisions, completedCalls] = await Promise.all([
      this.prisma.collectedDocument.count({ where: { edition: { scanRunId: job.scanRunId } } }),
      this.prisma.documentFilterDecision.findMany({ where: { aiJobId: jobId }, orderBy: { document: { publicationOrder: 'asc' } } }),
      this.prisma.aiCall.findMany({ where: { aiJobId: jobId, phase: 'CONTENT', status: 'COMPLETED' }, select: { batchKey: true }, orderBy: { createdAt: 'asc' } }),
    ])
    return {
      titlePassComplete: decisions.length === documentCount,
      unresolvedDocumentIds: decisions.filter((decision) => decision.titleDecision === 'MAYBE' && decision.finalDecision === null).map((decision) => decision.documentId),
      completedContentBatchKeys: [...new Set(completedCalls.map((call) => call.batchKey))],
      finalCounts: {
        in: decisions.filter((decision) => decision.finalDecision === 'IN').length,
        out: decisions.filter((decision) => decision.finalDecision === 'OUT').length,
        pending: Math.max(0, documentCount - decisions.filter((decision) => decision.finalDecision !== null).length),
      },
    }
  }

  async markFilterRunning(runId: string, jobId: string, totalItems: number): Promise<void> {
    const now = new Date()
    await this.prisma.$transaction([
      this.prisma.scanRun.update({ where: { id: runId }, data: { status: 'RUNNING', currentStage: 'AI_FILTERING', totalItems, errorSummary: null } }),
      this.prisma.aiJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: now, completedAt: null, lastErrorCategory: null, lastErrorMessage: null } }),
      this.prisma.stageExecution.upsert({
        where: { scanRunId_stage: { scanRunId: runId, stage: 'AI_FILTERING' } },
        create: { scanRunId: runId, stage: 'AI_FILTERING', status: 'RUNNING', totalItems, startedAt: now },
        update: { status: 'RUNNING', totalItems, startedAt: now, completedAt: null, errorSummary: null },
      }),
    ])
  }

  async markFilterAwaitingRetry(runId: string, jobId: string, error: AiCallFailure): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.scanRun.update({ where: { id: runId }, data: { status: 'AWAITING_RETRY', currentStage: 'AI_FILTERING', errorSummary: error.message } }),
      this.prisma.aiJob.update({ where: { id: jobId }, data: { status: 'AWAITING_RETRY', lastErrorCategory: error.category, lastErrorMessage: error.message } }),
      this.prisma.stageExecution.update({ where: { scanRunId_stage: { scanRunId: runId, stage: 'AI_FILTERING' } }, data: { status: 'AWAITING_RETRY', errorSummary: error.message } }),
    ])
  }

  async completeFilter(runId: string, jobId: string): Promise<void> {
    const now = new Date()
    await this.prisma.$transaction([
      this.prisma.aiJob.update({ where: { id: jobId }, data: { status: 'COMPLETED', completedAt: now, lastErrorCategory: null, lastErrorMessage: null } }),
      this.prisma.stageExecution.update({ where: { scanRunId_stage: { scanRunId: runId, stage: 'AI_FILTERING' } }, data: { status: 'COMPLETED', completedAt: now, errorSummary: null } }),
    ])
  }

  async nextAiCallAttempt(aiJobId: string, phase: 'TITLE' | 'CONTENT', batchKey: string): Promise<number> {
    const aggregate = await this.prisma.aiCall.aggregate({ where: { aiJobId, phase, batchKey }, _max: { attemptNo: true } })
    return (aggregate._max.attemptNo ?? 0) + 1
  }

  async addDownloadedBytes(runId: string, byteSize: bigint): Promise<void> {
    await this.prisma.scanRun.update({ where: { id: runId }, data: { downloadedBytes: { increment: byteSize } } })
  }

  async requestAiFilterRetry(runId: string, requestKey: string): Promise<{ runId: string; commandId: string; status: 'QUEUED' }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.scanOutbox.findUnique({ where: { requestKey } })
      if (existing) {
        if (existing.scanRunId !== runId || existing.commandType !== 'RETRY_AI_FILTER') throw new AiFilterRetryConflictError('Idempotency key belongs to another command')
        return { runId, commandId: existing.id, status: 'QUEUED' as const }
      }
      const run = await tx.scanRun.findUnique({ where: { id: runId }, include: { aiJobs: { where: { kind: 'DOCUMENT_FILTER' } } } })
      const job = run?.aiJobs[0]
      if (!run || !job || run.status !== 'AWAITING_RETRY' || run.currentStage !== 'AI_FILTERING' || job.status !== 'AWAITING_RETRY') {
        throw new AiFilterRetryConflictError('AI filter is not awaiting retry')
      }
      const command = await tx.scanOutbox.create({ data: { scanRunId: runId, commandType: 'RETRY_AI_FILTER', requestKey } })
      await Promise.all([
        tx.scanRun.update({ where: { id: runId }, data: { status: 'QUEUED', errorSummary: null } }),
        tx.aiJob.update({ where: { id: job.id }, data: { status: 'QUEUED', lastErrorCategory: null, lastErrorMessage: null } }),
        tx.stageExecution.update({ where: { scanRunId_stage: { scanRunId: runId, stage: 'AI_FILTERING' } }, data: { status: 'PENDING', errorSummary: null } }),
      ])
      return { runId, commandId: command.id, status: 'QUEUED' as const }
    })
  }

  async completedSnapshot(runId: string): Promise<CompletedRunSnapshot> {
    const run = await this.getRun(runId)
    if (!run) throw new Error(`Scan run not found: ${runId}`)
    const raw = await this.prisma.scanRun.findUniqueOrThrow({ where: { id: runId } })
    if (!raw.indexSourceUrl || !raw.indexObjectKey || !raw.indexSha256) throw new Error('Run index metadata is incomplete')
    const documents = await this.prisma.collectedDocument.findMany({ where: { edition: { scanRunId: runId } }, include: { storedObject: true, assets: { include: { storedObject: true } } } })
    const objects: CompletedRunSnapshot['objects'] = []
    for (const document of documents) {
      if (!document.storedObject) throw new Error(`Document object missing: ${document.id}`)
      objects.push({ documentId: document.id, sourceUrl: document.sourceUrl, objectKey: document.storedObject.objectKey, sha256: document.storedObject.sha256, mediaType: document.storedObject.mediaType, byteSize: document.storedObject.byteSize })
      for (const asset of document.assets) {
        if (!asset.storedObject) throw new Error(`Asset object missing: ${asset.id}`)
        objects.push({ assetId: asset.id, parentDocumentId: document.id, sourceUrl: asset.sourceUrl, role: asset.role, objectKey: asset.storedObject.objectKey, sha256: asset.storedObject.sha256, mediaType: asset.storedObject.mediaType, byteSize: asset.storedObject.byteSize })
      }
    }
    const filterJob = await this.prisma.aiJob.findUnique({
      where: { scanRunId_kind: { scanRunId: runId, kind: 'DOCUMENT_FILTER' } },
      include: { decisions: { orderBy: { document: { publicationOrder: 'asc' } } } },
    })
    const filterAudit: CompletedRunSnapshot['filterAudit'] = filterJob ? {
      model: filterJob.model,
      titlePromptVersion: filterJob.titlePromptVersion,
      contentPromptVersion: filterJob.contentPromptVersion,
      configurationHash: filterJob.configurationHash,
      decisions: filterJob.decisions.map((decision) => ({
        documentId: decision.documentId,
        titleDecision: decision.titleDecision,
        titleReason: decision.titleReason,
        titleConfidence: decision.titleConfidence,
        contentDecision: decision.contentDecision,
        contentReason: decision.contentReason,
        contentConfidence: decision.contentConfidence,
        finalDecision: decision.finalDecision,
      })),
    } : null
    return { run, index: { sourceUrl: raw.indexSourceUrl, objectKey: raw.indexObjectKey, sha256: raw.indexSha256 }, objects, filterAudit }
  }

  private async upsertObject(object: StoredBlob): Promise<string> {
    const saved = await this.prisma.storedObject.upsert({
      where: { sha256: object.sha256 },
      create: { sha256: object.sha256, bucket: object.bucket, objectKey: object.objectKey, mediaType: object.mediaType, byteSize: object.byteSize, versionId: object.versionId ?? null },
      update: {}, select: { id: true },
    })
    return saved.id
  }

  private async syncFilterStageProgress(tx: Prisma.TransactionClient, runId: string, jobId: string): Promise<void> {
    const completedItems = await tx.documentFilterDecision.count({ where: { aiJobId: jobId, finalDecision: { not: null } } })
    await Promise.all([
      tx.scanRun.update({ where: { id: runId }, data: { completedItems } }),
      tx.stageExecution.update({ where: { scanRunId_stage: { scanRunId: runId, stage: 'AI_FILTERING' } }, data: { completedItems } }),
    ])
  }
}

export class AiFilterRetryConflictError extends Error {
  override readonly name = 'AiFilterRetryConflictError'
}
