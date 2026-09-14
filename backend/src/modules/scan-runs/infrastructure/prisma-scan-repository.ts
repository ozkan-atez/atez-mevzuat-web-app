import { Prisma, type PrismaClient } from '@prisma/client'
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
  PreviousSourceConfiguration,
  PreviousSourceCallInput,
  PreviousSourceCandidateRecord,
  PreviousSourceIntentRecord,
  PreviousSourceJobRecord,
  PreviousSourceWorkItem,
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

  async claimPendingOutbox(limit: number): Promise<Array<{ id: string; scanRunId: string; commandType: 'START_SCAN' | 'RETRY_AI_FILTER' | 'RETRY_PREVIOUS_SOURCES'; attempts: number }>> {
    const leaseUntil = new Date(Date.now() + 60_000)
    return this.prisma.$queryRaw<Array<{ id: string; scanRunId: string; commandType: 'START_SCAN' | 'RETRY_AI_FILTER' | 'RETRY_PREVIOUS_SOURCES'; attempts: number }>>(Prisma.sql`
      WITH candidates AS (
        SELECT id FROM "ScanOutbox"
        WHERE "dispatchedAt" IS NULL AND "availableAt" <= NOW()
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "ScanOutbox" AS outbox
      SET "availableAt" = ${leaseUntil}, attempts = outbox.attempts + 1
      FROM candidates
      WHERE outbox.id = candidates.id
      RETURNING outbox.id, outbox."scanRunId", outbox."commandType", outbox.attempts
    `)
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
      data: { lastError: error, availableAt },
    })
  }

  async getExecutionRun(runId: string): Promise<{ id: string; status: ScanRunStatus; targetDate: string; downloadedBytes: bigint; indexObjectKey: string | null; indexSourceUrl: string | null } | null> {
    const run = await this.prisma.scanRun.findUnique({ where: { id: runId } })
    return run ? {
      id: run.id,
      status: run.status,
      targetDate: run.targetDate.toISOString().slice(0, 10),
      downloadedBytes: run.downloadedBytes,
      indexObjectKey: run.indexObjectKey,
      indexSourceUrl: run.indexSourceUrl,
    } : null
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
    await this.prisma.$transaction(async (tx) => {
      for (const edition of editions) {
        const storedEdition = await tx.gazetteEdition.upsert({
          where: { scanRunId_indexUrl: { scanRunId: runId, indexUrl: edition.indexUrl } },
          create: {
            scanRunId: runId,
            publicationDate: new Date(`${targetDate}T00:00:00.000Z`),
            type: edition.type,
            supplementNo: edition.supplementNo,
            indexUrl: edition.indexUrl,
            discoveryOrder: edition.discoveryOrder,
          },
          update: { type: edition.type, supplementNo: edition.supplementNo, discoveryOrder: edition.discoveryOrder },
          select: { id: true },
        })
        await tx.collectedDocument.createMany({
          data: edition.documents.map((document) => ({
            editionId: storedEdition.id,
            title: document.title,
            documentType: document.documentType ?? null,
            sourceUrl: document.sourceUrl,
            publicationOrder: document.publicationOrder,
          })),
          skipDuplicates: true,
        })
      }
    })
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

  async listAssets(runId: string): Promise<Array<{ id: string; documentId: string; sourceUrl: string; storedObject: null | { objectKey: string; mediaType: string } }>> {
    return this.prisma.documentAsset.findMany({
      where: { document: { edition: { scanRunId: runId } } }, orderBy: { sourceUrl: 'asc' },
      select: { id: true, documentId: true, sourceUrl: true, storedObject: { select: { objectKey: true, mediaType: true } } },
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
        previousSourceJobs: { include: { source: true } },
        topicProcesses: {
          orderBy: [{ document: { edition: { discoveryOrder: 'asc' } } }, { document: { publicationOrder: 'asc' } }],
          include: { document: true, analyses: { orderBy: { version: 'desc' }, take: 1 }, reports: { include: { revisions: { orderBy: { version: 'desc' }, take: 1 } } } },
        },
        topicReports: { include: { revisions: { where: { status: 'VALIDATED' }, orderBy: { version: 'desc' }, take: 1 } } },
        editions: { orderBy: { discoveryOrder: 'asc' }, include: { documents: { orderBy: { publicationOrder: 'asc' }, include: { _count: { select: { assets: true } } } } } },
      },
    })
    if (!run) return null
    const assets = await this.prisma.documentAsset.count({ where: { document: { edition: { scanRunId: runId } } } })
    const filterJob = run.aiJobs[0] ?? null
    const filterDecisions = new Map(filterJob?.decisions.map((decision) => [decision.documentId, decision]) ?? [])
    const previousSourceJobs = new Map(run.previousSourceJobs.map((job) => [job.documentId, job]))
    const previousCompleted = run.previousSourceJobs.filter((job) => job.status === 'COMPLETED').length
    const previousVerified = run.previousSourceJobs.filter((job) => job.outcome === 'VERIFIED').length
    const previousNotRequired = run.previousSourceJobs.filter((job) => job.outcome === 'NOT_REQUIRED').length
    const previousNotFound = run.previousSourceJobs.filter((job) => job.outcome === 'NOT_FOUND').length
    const previousAmbiguous = run.previousSourceJobs.filter((job) => job.outcome === 'AMBIGUOUS').length
    const hasPreviousAwaitingRetry = run.previousSourceJobs.some((job) => job.status === 'AWAITING_RETRY')
    const previousStatus = run.status === 'AWAITING_RETRY' && hasPreviousAwaitingRetry ? 'AWAITING_RETRY'
      : run.previousSourceJobs.some((job) => job.status === 'RUNNING') ? 'RUNNING'
      : run.previousSourceJobs.some((job) => job.status === 'QUEUED') ? 'QUEUED'
      : run.previousSourceJobs.some((job) => job.status === 'FAILED') ? 'FAILED'
      : run.previousSourceJobs.every((job) => job.status === 'COMPLETED') ? 'COMPLETED'
      : hasPreviousAwaitingRetry ? 'AWAITING_RETRY'
      : 'QUEUED'
    const finalIn = filterJob?.decisions.filter((decision) => decision.finalDecision === 'IN').length ?? 0
    const finalOut = filterJob?.decisions.filter((decision) => decision.finalDecision === 'OUT').length ?? 0
    const documentCount = run.editions.reduce((count, edition) => count + edition.documents.length, 0)
    const analysisCompleted = run.topicProcesses.filter((topic) => topic.status === 'COMPLETED').length
    const analysisAwaitingRetry = run.topicProcesses.filter((topic) => topic.status === 'AWAITING_RETRY').length
    const analysisFailed = run.topicProcesses.filter((topic) => topic.status === 'FAILED' || topic.status === 'BLOCKED').length
    const reports = run.topicReports.flatMap((report) => {
      const revision = report.revisions[0]
      return revision ? [{ id: report.id, topicId: report.topicId, title: report.title, basename: report.basename, card: revision.card, version: revision.version, htmlObjectKey: revision.htmlObjectKey }] : []
    })
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
      previousSources: run.previousSourceJobs.length > 0 ? {
        status: previousStatus,
        counts: {
          total: run.previousSourceJobs.length,
          completed: previousCompleted,
          verified: previousVerified,
          notRequired: previousNotRequired,
          notFound: previousNotFound,
          ambiguous: previousAmbiguous,
          pending: run.previousSourceJobs.length - previousCompleted,
        },
        retryAvailable: run.status === 'AWAITING_RETRY' && previousStatus === 'AWAITING_RETRY',
        errorMessage: run.previousSourceJobs.find((job) => job.lastErrorMessage)?.lastErrorMessage ?? null,
      } : null,
      analysis: run.topicProcesses.length > 0 || run.stages.some((stage) => stage.stage === 'ANALYZING_TOPICS') ? {
        counts: { total: run.topicProcesses.length, completed: analysisCompleted, awaitingRetry: analysisAwaitingRetry, failed: analysisFailed },
        topics: run.topicProcesses.map((topic) => {
          const analysis = topic.analyses[0]
          const report = topic.reports[0]
          const reportRevision = report?.revisions[0]
          return {
            id: topic.id, documentId: topic.documentId, title: topic.document.title, status: topic.status,
            retryAvailable: topic.status === 'AWAITING_RETRY', errorCategory: topic.lastErrorCategory, errorMessage: topic.lastErrorMessage,
            analysisVersion: analysis?.version ?? null, reportVersion: reportRevision?.version ?? null,
            reportCard: reportRevision?.card ?? null, reportBasename: report?.basename ?? null,
          }
        }),
      } : null,
      reports,
      counts: { editions: run.editions.length, documents: run.editions.reduce((n, e) => n + e.documents.length, 0), assets, completedItems: run.completedItems, totalItems: run.totalItems, failedItems: run.failedItems },
      stages: run.stages.map((stage) => ({ stage: stage.stage, status: stage.status, completedItems: stage.completedItems, totalItems: stage.totalItems, failedItems: stage.failedItems })),
      editions: run.editions.map((edition) => ({
        id: edition.id, type: edition.type, supplementNo: edition.supplementNo,
        documents: edition.documents.map((document) => {
          const decision = filterDecisions.get(document.id)
          const previous = previousSourceJobs.get(document.id)
          return {
            id: document.id, title: document.title, sourceUrl: document.sourceUrl,
            validationStatus: document.validationStatus, assetCount: document._count.assets,
            filter: decision ? {
              titleDecision: decision.titleDecision,
              finalDecision: decision.finalDecision,
              reason: decision.contentReason ?? decision.titleReason,
            } : null,
            previousSource: previous ? {
              status: previous.status,
              outcome: previous.outcome,
              needsPreviousSource: previous.needsPreviousSource,
              reason: previous.reason,
              title: previous.source?.title ?? null,
              publicationDate: previous.source?.publicationDate.toISOString().slice(0, 10) ?? null,
              gazetteNo: previous.source?.gazetteNo ?? null,
              sourceUrl: previous.source?.sourceUrl ?? null,
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

  async ensurePreviousSourceJobs(runId: string, configuration: PreviousSourceConfiguration): Promise<PreviousSourceJobRecord[]> {
    const documents = await this.prisma.collectedDocument.findMany({
      where: {
        edition: { scanRunId: runId },
        filterDecisions: { some: { aiJob: { kind: 'DOCUMENT_FILTER' }, finalDecision: 'IN' } },
      },
      orderBy: [{ edition: { discoveryOrder: 'asc' } }, { publicationOrder: 'asc' }],
      select: { id: true },
    })
    if (documents.length > 0) {
      await this.prisma.previousSourceJob.createMany({
        data: documents.map((document) => ({
          scanRunId: runId,
          documentId: document.id,
          model: configuration.model,
          promptVersion: configuration.promptVersion,
          configurationHash: configuration.configurationHash,
        })),
        skipDuplicates: true,
      })
    }
    return this.prisma.previousSourceJob.findMany({
      where: { scanRunId: runId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, documentId: true, status: true },
    })
  }

  async listPreviousSourceWork(runId: string): Promise<PreviousSourceWorkItem[]> {
    const jobs = await this.prisma.previousSourceJob.findMany({
      where: { scanRunId: runId, status: { not: 'COMPLETED' } },
      orderBy: { createdAt: 'asc' },
      include: { document: { include: { edition: true, storedObject: true } } },
    })
    return jobs.map((job) => {
      if (!job.document.storedObject) throw new Error(`Current document object is missing: ${job.documentId}`)
      return {
        id: job.id,
        documentId: job.documentId,
        status: job.status,
        intent: job.needsPreviousSource === null ? null : {
          needsPreviousSource: job.needsPreviousSource,
          relationship: job.relationship ?? 'NONE',
          targetRegulationTitle: job.targetRegulationTitle,
          targetRegulationIdentifier: job.targetRegulationIdentifier,
          targetRegulationType: job.targetRegulationType,
          targetInstitution: job.targetInstitution,
          targetArticleReferences: stringArray(job.targetArticleReferences),
          queryCandidates: stringArray(job.queryCandidates),
          reason: job.reason ?? '',
        },
        document: {
          title: job.document.title,
          sourceUrl: job.document.sourceUrl,
          documentType: job.document.documentType,
          publicationDate: job.document.edition.publicationDate.toISOString().slice(0, 10),
          storedObject: {
            objectKey: job.document.storedObject.objectKey,
            sha256: job.document.storedObject.sha256,
            mediaType: job.document.storedObject.mediaType,
            byteSize: job.document.storedObject.byteSize,
          },
        },
      }
    })
  }

  async markPreviousSourceJobRunning(jobId: string): Promise<void> {
    await this.prisma.previousSourceJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING', startedAt: new Date(), completedAt: null, lastErrorCategory: null, lastErrorMessage: null },
    })
  }

  async nextPreviousSourceCallAttempt(jobId: string): Promise<number> {
    const aggregate = await this.prisma.previousSourceCall.aggregate({ where: { jobId }, _max: { attemptNo: true } })
    return (aggregate._max.attemptNo ?? 0) + 1
  }

  async startPreviousSourceCall(input: PreviousSourceCallInput): Promise<AiCallRecord> {
    return this.prisma.previousSourceCall.create({ data: input, select: { id: true } })
  }

  async completePreviousSourceCall(callId: string, result: AiCallCompletion): Promise<void> {
    await this.prisma.previousSourceCall.update({
      where: { id: callId },
      data: { status: 'COMPLETED', providerRequestId: result.providerRequestId, inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs: result.latencyMs, completedAt: new Date() },
    })
  }

  async failPreviousSourceCall(callId: string, error: AiCallFailure): Promise<void> {
    await this.prisma.previousSourceCall.update({
      where: { id: callId },
      data: { status: 'FAILED', errorCategory: error.category, providerStatus: error.providerStatus, errorMessage: error.message, completedAt: new Date() },
    })
  }

  async savePreviousSourceIntent(jobId: string, intent: PreviousSourceIntentRecord): Promise<void> {
    await this.prisma.previousSourceJob.update({
      where: { id: jobId },
      data: {
        needsPreviousSource: intent.needsPreviousSource,
        relationship: intent.relationship,
        targetRegulationTitle: intent.targetRegulationTitle,
        targetRegulationIdentifier: intent.targetRegulationIdentifier,
        targetRegulationType: intent.targetRegulationType,
        targetInstitution: intent.targetInstitution,
        targetArticleReferences: intent.targetArticleReferences,
        queryCandidates: intent.queryCandidates,
        reason: intent.reason,
      },
    })
  }

  async savePreviousSourceCandidates(jobId: string, candidates: PreviousSourceCandidateRecord[]): Promise<void> {
    await this.prisma.$transaction(candidates.map((candidate) => this.prisma.previousSourceCandidate.upsert({
      where: { jobId_url: { jobId, url: candidate.url } },
      create: {
        jobId, query: candidate.query, title: candidate.title,
        publicationDate: new Date(`${candidate.publicationDate}T00:00:00.000Z`),
        gazetteNo: candidate.gazetteNo, mukerrer: candidate.mukerrer, url: candidate.url,
        documentUrl: candidate.documentUrl ?? null, regulationType: candidate.regulationType,
        exactIdentifierMatch: candidate.exactIdentifierMatch, titleScore: candidate.titleScore,
        score: candidate.score, reasons: candidate.reasons, selected: candidate.selected,
      },
      update: {
        query: candidate.query, title: candidate.title,
        publicationDate: new Date(`${candidate.publicationDate}T00:00:00.000Z`),
        gazetteNo: candidate.gazetteNo, mukerrer: candidate.mukerrer,
        documentUrl: candidate.documentUrl ?? null, regulationType: candidate.regulationType,
        exactIdentifierMatch: candidate.exactIdentifierMatch, titleScore: candidate.titleScore,
        score: candidate.score, reasons: candidate.reasons, selected: candidate.selected,
      },
    })))
  }

  async completePreviousSourceOutcome(jobId: string, outcome: 'NOT_REQUIRED' | 'NOT_FOUND' | 'AMBIGUOUS'): Promise<void> {
    await this.prisma.previousSourceJob.update({ where: { id: jobId }, data: { status: 'COMPLETED', outcome, completedAt: new Date() } })
  }

  async completePreviousSourceVerified(jobId: string, input: {
    candidate: PreviousSourceCandidateRecord
    sourceUrl: string
    object: StoredBlob
    assets: Array<{ sourceUrl: string; referenceText?: string; role: 'ATTACHMENT' | 'IMAGE' | 'STYLESHEET_ASSET' | 'OTHER_SUPPORTED'; object: StoredBlob }>
  }): Promise<void> {
    const storedObjectId = await this.upsertObject(input.object)
    const assetObjectIds = new Map<string, string>()
    for (const asset of input.assets) assetObjectIds.set(asset.sourceUrl, await this.upsertObject(asset.object))
    await this.prisma.$transaction(async (tx) => {
      await tx.previousSourceCandidate.updateMany({ where: { jobId }, data: { selected: false } })
      await tx.previousSourceCandidate.update({ where: { jobId_url: { jobId, url: input.candidate.url } }, data: { selected: true, documentUrl: input.sourceUrl } })
      const source = await tx.previousSourceDocument.upsert({
        where: { jobId },
        create: {
          jobId, title: input.candidate.title,
          publicationDate: new Date(`${input.candidate.publicationDate}T00:00:00.000Z`),
          gazetteNo: input.candidate.gazetteNo, mukerrer: input.candidate.mukerrer,
          sourceUrl: input.sourceUrl, storedObjectId, validationStatus: 'VALID',
        },
        update: {
          title: input.candidate.title,
          publicationDate: new Date(`${input.candidate.publicationDate}T00:00:00.000Z`),
          gazetteNo: input.candidate.gazetteNo, mukerrer: input.candidate.mukerrer,
          sourceUrl: input.sourceUrl, storedObjectId, validationStatus: 'VALID',
        },
      })
      for (const asset of input.assets) {
        await tx.previousSourceAsset.upsert({
          where: { previousSourceId_sourceUrl: { previousSourceId: source.id, sourceUrl: asset.sourceUrl } },
          create: { previousSourceId: source.id, storedObjectId: assetObjectIds.get(asset.sourceUrl)!, sourceUrl: asset.sourceUrl, referenceText: asset.referenceText ?? null, role: asset.role, validationStatus: 'VALID' },
          update: { storedObjectId: assetObjectIds.get(asset.sourceUrl)!, referenceText: asset.referenceText ?? null, role: asset.role, validationStatus: 'VALID' },
        })
      }
      await tx.previousSourceJob.update({ where: { id: jobId }, data: { status: 'COMPLETED', outcome: 'VERIFIED', completedAt: new Date() } })
    })
  }

  async markPreviousSourceAwaitingRetry(jobId: string, error: AiCallFailure): Promise<void> {
    await this.prisma.previousSourceJob.update({
      where: { id: jobId },
      data: { status: 'AWAITING_RETRY', lastErrorCategory: error.category, lastErrorMessage: error.message },
    })
  }

  async getPreviousSourceProgress(runId: string): Promise<{ total: number; completed: number; awaitingRetry: number }> {
    const [total, completed, awaitingRetry] = await Promise.all([
      this.prisma.previousSourceJob.count({ where: { scanRunId: runId } }),
      this.prisma.previousSourceJob.count({ where: { scanRunId: runId, status: 'COMPLETED' } }),
      this.prisma.previousSourceJob.count({ where: { scanRunId: runId, status: 'AWAITING_RETRY' } }),
    ])
    return { total, completed, awaitingRetry }
  }

  async markPreviousSourceStageAwaitingRetry(runId: string, message: string): Promise<void> {
    const progress = await this.getPreviousSourceProgress(runId)
    await this.prisma.$transaction([
      this.prisma.scanRun.update({ where: { id: runId }, data: { status: 'AWAITING_RETRY', currentStage: 'DISCOVERING_PREVIOUS_SOURCES', completedItems: progress.completed, failedItems: progress.awaitingRetry, errorSummary: message } }),
      this.prisma.stageExecution.update({
        where: { scanRunId_stage: { scanRunId: runId, stage: 'DISCOVERING_PREVIOUS_SOURCES' } },
        data: { status: 'AWAITING_RETRY', totalItems: progress.total, completedItems: progress.completed, failedItems: progress.awaitingRetry, errorSummary: message },
      }),
    ])
  }

  async markTopicAnalysisAwaitingRetry(runId: string, counts: { total: number; completed: number; awaitingRetry: number; failed: number }): Promise<void> {
    const message = 'Mevzuat analizlerinden bazıları yeniden deneme bekliyor.'
    await this.prisma.$transaction([
      this.prisma.scanRun.update({ where: { id: runId }, data: { status: 'AWAITING_RETRY', currentStage: 'ANALYZING_TOPICS', completedItems: counts.completed, failedItems: counts.awaitingRetry, errorSummary: message } }),
      this.prisma.stageExecution.update({
        where: { scanRunId_stage: { scanRunId: runId, stage: 'ANALYZING_TOPICS' } },
        data: { status: 'AWAITING_RETRY', totalItems: counts.total, completedItems: counts.completed, failedItems: counts.awaitingRetry, errorSummary: message },
      }),
    ])
  }

  async requestPreviousSourceRetry(runId: string, requestKey: string): Promise<{ runId: string; commandId: string; status: 'QUEUED' }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.scanOutbox.findUnique({ where: { requestKey } })
      if (existing) {
        if (existing.scanRunId !== runId || existing.commandType !== 'RETRY_PREVIOUS_SOURCES') {
          throw new PreviousSourceRetryConflictError('Idempotency key belongs to another command')
        }
        return { runId, commandId: existing.id, status: 'QUEUED' as const }
      }

      const run = await tx.scanRun.findUnique({ where: { id: runId } })
      const awaitingRetryCount = await tx.previousSourceJob.count({ where: { scanRunId: runId, status: 'AWAITING_RETRY' } })
      if (!run || run.status !== 'AWAITING_RETRY' || run.currentStage !== 'DISCOVERING_PREVIOUS_SOURCES' || awaitingRetryCount === 0) {
        throw new PreviousSourceRetryConflictError('Previous source discovery is not awaiting retry')
      }

      const command = await tx.scanOutbox.create({ data: { scanRunId: runId, commandType: 'RETRY_PREVIOUS_SOURCES', requestKey } })
      await Promise.all([
        tx.scanRun.update({ where: { id: runId }, data: { status: 'QUEUED', errorSummary: null } }),
        tx.previousSourceJob.updateMany({
          where: { scanRunId: runId, status: 'AWAITING_RETRY' },
          data: { status: 'QUEUED', lastErrorCategory: null, lastErrorMessage: null },
        }),
        tx.stageExecution.update({
          where: { scanRunId_stage: { scanRunId: runId, stage: 'DISCOVERING_PREVIOUS_SOURCES' } },
          data: { status: 'PENDING', errorSummary: null },
        }),
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
    const previousJobs = await this.prisma.previousSourceJob.findMany({
      where: { scanRunId: runId },
      orderBy: { createdAt: 'asc' },
      include: {
        calls: { orderBy: { attemptNo: 'asc' } },
        candidates: { orderBy: [{ score: 'desc' }, { publicationDate: 'desc' }] },
        source: { include: { storedObject: true, assets: { include: { storedObject: true } } } },
      },
    })
    const previousSourceAudit: CompletedRunSnapshot['previousSourceAudit'] = previousJobs.map((job) => ({
      documentId: job.documentId,
      status: job.status,
      outcome: job.outcome,
      model: job.model,
      promptVersion: job.promptVersion,
      configurationHash: job.configurationHash,
      intent: job.needsPreviousSource === null ? null : {
        needsPreviousSource: job.needsPreviousSource,
        relationship: job.relationship ?? 'NONE',
        targetRegulationTitle: job.targetRegulationTitle,
        targetRegulationIdentifier: job.targetRegulationIdentifier,
        targetRegulationType: job.targetRegulationType,
        targetInstitution: job.targetInstitution,
        targetArticleReferences: stringArray(job.targetArticleReferences),
        queryCandidates: stringArray(job.queryCandidates),
        reason: job.reason ?? '',
      },
      calls: job.calls.map((call) => ({
        attemptNo: call.attemptNo,
        status: call.status,
        inputHash: call.inputHash,
        providerRequestId: call.providerRequestId,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        latencyMs: call.latencyMs,
        errorCategory: call.errorCategory,
        providerStatus: call.providerStatus,
        errorMessage: call.errorMessage,
      })),
      candidates: job.candidates.map((candidate) => ({
        query: candidate.query,
        title: candidate.title,
        publicationDate: candidate.publicationDate.toISOString().slice(0, 10),
        gazetteNo: candidate.gazetteNo,
        mukerrer: candidate.mukerrer,
        url: candidate.url,
        documentUrl: candidate.documentUrl,
        regulationType: candidate.regulationType,
        exactIdentifierMatch: candidate.exactIdentifierMatch,
        titleScore: candidate.titleScore,
        score: candidate.score,
        reasons: stringArray(candidate.reasons),
        selected: candidate.selected,
      })),
      source: job.source ? {
        title: job.source.title,
        publicationDate: job.source.publicationDate.toISOString().slice(0, 10),
        gazetteNo: job.source.gazetteNo,
        mukerrer: job.source.mukerrer,
        sourceUrl: job.source.sourceUrl,
        objectKey: job.source.storedObject.objectKey,
        sha256: job.source.storedObject.sha256,
        mediaType: job.source.storedObject.mediaType,
        byteSize: job.source.storedObject.byteSize,
        assets: job.source.assets.map((asset) => ({
          sourceUrl: asset.sourceUrl,
          referenceText: asset.referenceText,
          role: asset.role,
          objectKey: asset.storedObject.objectKey,
          sha256: asset.storedObject.sha256,
          mediaType: asset.storedObject.mediaType,
          byteSize: asset.storedObject.byteSize,
        })),
      } : null,
    }))
    const topics = await this.prisma.topicProcess.findMany({
      where: { scanRunId: runId },
      orderBy: { createdAt: 'asc' },
      include: {
        evidenceBundle: true,
        analyses: { orderBy: { version: 'asc' } },
        executions: { orderBy: [{ kind: 'asc' }, { attemptNo: 'asc' }] },
        reports: { include: { revisions: { orderBy: { version: 'asc' } } } },
      },
    })
    const noChangeReports = await this.prisma.topicReport.findMany({
      where: { scanRunId: runId, topicId: null, card: 'K6' },
      include: { revisions: { orderBy: { version: 'asc' } } },
    })
    const topicAnalysisAudit: NonNullable<CompletedRunSnapshot['topicAnalysisAudit']> = {
      topics: topics.map((topic) => ({
        topicId: topic.id,
        documentId: topic.documentId,
        status: topic.status,
        evidenceManifestObjectKey: topic.evidenceBundle?.manifestObjectKey ?? null,
        sourceSignature: topic.evidenceBundle?.sourceSignature ?? null,
        analyses: topic.analyses.map((analysis) => ({
          id: analysis.id, version: analysis.version, status: analysis.status,
          analysisObjectKey: analysis.analysisObjectKey, markdownObjectKey: analysis.markdownObjectKey,
          model: analysis.model, promptVersion: analysis.promptVersion, schemaVersion: analysis.schemaVersion,
          inputTokens: analysis.inputTokens, outputTokens: analysis.outputTokens,
        })),
        executions: topic.executions.map((execution) => ({
          kind: execution.kind, attemptNo: execution.attemptNo, status: execution.status,
          model: execution.model, promptVersion: execution.promptVersion, schemaVersion: execution.schemaVersion,
          inputHash: execution.inputHash, providerRequestId: execution.providerRequestId,
          inputTokens: execution.inputTokens, outputTokens: execution.outputTokens, latencyMs: execution.latencyMs,
          errorCategory: execution.errorCategory, providerStatus: execution.providerStatus, errorMessage: execution.errorMessage,
        })),
        reports: topic.reports.map((report) => ({
          id: report.id, basename: report.basename, card: report.card,
          revisions: report.revisions.map((revision) => ({
            version: revision.version, status: revision.status, card: revision.card,
            analysisRevisionId: revision.analysisRevisionId, specObjectKey: revision.specObjectKey, htmlObjectKey: revision.htmlObjectKey,
          })),
        })),
      })),
      noChangeReports: noChangeReports.map((report) => ({
        id: report.id, basename: report.basename, card: report.card,
        revisions: report.revisions.map((revision) => ({
          version: revision.version, status: revision.status, card: revision.card,
          specObjectKey: revision.specObjectKey, htmlObjectKey: revision.htmlObjectKey,
        })),
      })),
    }
    return { run, index: { sourceUrl: raw.indexSourceUrl, objectKey: raw.indexObjectKey, sha256: raw.indexSha256 }, objects, filterAudit, previousSourceAudit, topicAnalysisAudit }
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

export class PreviousSourceRetryConflictError extends Error {
  override readonly name = 'PreviousSourceRetryConflictError'
}

function stringArray(value: Prisma.JsonValue | null): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
