import { Prisma, type PrismaClient } from '@prisma/client'
import type { AiCallFailure } from '../../scan-runs/application/ports'
import type {
  CreateTopicAnalysisRevisionInput,
  CreateTopicReportRevisionInput,
  RunTopicAnalysisRepository,
  TopicAnalysisRepository,
  TopicEvidenceAsset,
  TopicEvidenceInput,
  TopicStoredObject,
} from '../application/ports'

export class PrismaTopicAnalysisRepository implements RunTopicAnalysisRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async ensureTopics(runId: string) {
    return this.prisma.$transaction(async (tx) => {
      const decisions = await tx.documentFilterDecision.findMany({
        where: {
          finalDecision: 'IN',
          document: { edition: { scanRunId: runId } },
        },
        orderBy: [
          { document: { edition: { discoveryOrder: 'asc' } } },
          { document: { publicationOrder: 'asc' } },
        ],
        include: { document: true },
      })

      for (const decision of decisions) {
        await tx.topicProcess.upsert({
          where: { documentId: decision.documentId },
          update: {},
          create: {
            scanRunId: runId,
            documentId: decision.documentId,
            evidenceBundle: { create: {} },
            thread: { create: { title: decision.document.title } },
          },
        })
      }

      return tx.topicProcess.findMany({
        where: { scanRunId: runId },
        orderBy: [
          { document: { edition: { discoveryOrder: 'asc' } } },
          { document: { publicationOrder: 'asc' } },
        ],
        select: { id: true, documentId: true, status: true },
      })
    })
  }

  async getTopicEvidenceInput(topicId: string): Promise<TopicEvidenceInput | null> {
    const topic = await this.prisma.topicProcess.findUnique({
      where: { id: topicId },
      include: {
        scanRun: true,
        document: {
          include: {
            edition: true,
            storedObject: true,
            assets: { include: { storedObject: true }, orderBy: { sourceUrl: 'asc' } },
            previousSourceJob: {
              include: {
                source: {
                  include: {
                    storedObject: true,
                    assets: { include: { storedObject: true }, orderBy: { sourceUrl: 'asc' } },
                  },
                },
              },
            },
          },
        },
      },
    })
    if (!topic?.document.storedObject) return null

    const previousJob = topic.document.previousSourceJob
    const previous = previousJob?.outcome === 'VERIFIED' ? previousJob.source : null
    return {
      topicId: topic.id,
      runId: topic.scanRunId,
      targetDate: toIsoDate(topic.document.edition.publicationDate),
      document: {
        title: topic.document.title,
        sourceUrl: topic.document.sourceUrl,
        object: mapStoredObject(topic.document.storedObject),
        assets: topic.document.assets.flatMap(mapAsset),
      },
      previousSource: previous ? {
        title: previous.title,
        sourceUrl: previous.sourceUrl,
        object: mapStoredObject(previous.storedObject),
        assets: previous.assets.flatMap(mapAsset),
      } : null,
    }
  }

  async markTopicAnalyzing(topicId: string): Promise<void> {
    await this.prisma.topicProcess.update({
      where: { id: topicId },
      data: { status: 'ANALYZING', lastErrorCategory: null, lastErrorMessage: null },
    })
  }

  async saveEvidenceBundle(topicId: string, input: { manifestObjectKey: string; sourceSignature: string }): Promise<void> {
    await this.prisma.evidenceBundle.upsert({
      where: { topicId },
      update: input,
      create: { topicId, ...input },
    })
  }

  async nextAnalysisVersion(topicId: string): Promise<number> {
    const latest = await this.prisma.analysisRevision.aggregate({ where: { topicId }, _max: { version: true } })
    return (latest._max.version ?? 0) + 1
  }

  async startTopicAiExecution(input: {
    topicId: string
    kind: 'INITIAL_ANALYSIS' | 'ANALYSIS_REVISION' | 'PUBLICATION_REVISION'
    attemptNo: number
    model: string
    promptVersion: string
    schemaVersion: number
    inputHash: string
  }): Promise<{ id: string }> {
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.topicAiExecution.aggregate({
        where: { topicId: input.topicId, kind: input.kind },
        _max: { attemptNo: true },
      })
      return tx.topicAiExecution.create({
        data: { ...input, attemptNo: (latest._max.attemptNo ?? 0) + 1 },
        select: { id: true },
      })
    }, { isolationLevel: 'Serializable' })
  }

  async completeTopicAiExecution(id: string, input: {
    analysisRevisionId?: string
    providerRequestId: string | null
    latencyMs: number
    inputTokens: number | null
    outputTokens: number | null
  }): Promise<void> {
    await this.prisma.topicAiExecution.update({
      where: { id },
      data: { ...input, status: 'COMPLETED', completedAt: new Date() },
    })
  }

  async failTopicAiExecution(id: string, error: AiCallFailure): Promise<void> {
    await this.prisma.topicAiExecution.update({
      where: { id },
      data: {
        status: 'FAILED',
        errorCategory: error.category,
        providerStatus: error.providerStatus,
        errorMessage: error.message,
        completedAt: new Date(),
      },
    })
  }

  async markTopicAwaitingRetry(topicId: string, error: AiCallFailure): Promise<void> {
    await this.prisma.topicProcess.update({
      where: { id: topicId },
      data: { status: 'AWAITING_RETRY', lastErrorCategory: error.category, lastErrorMessage: error.message },
    })
  }

  async markTopicBlocked(topicId: string, message: string): Promise<void> {
    await this.prisma.topicProcess.update({
      where: { id: topicId },
      data: { status: 'BLOCKED', lastErrorCategory: 'INVALID_RESPONSE', lastErrorMessage: message },
    })
  }

  async getRunReportContext(runId: string) {
    const run = await this.prisma.scanRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        targetDate: true,
        indexSourceUrl: true,
        indexObjectKey: true,
        _count: { select: { editions: true } },
      },
    })
    if (!run?.indexSourceUrl || !run.indexObjectKey) return null
    const inspectedDocumentCount = await this.prisma.collectedDocument.count({ where: { edition: { scanRunId: runId } } })
    return {
      runId: run.id,
      targetDate: toIsoDate(run.targetDate),
      indexSourceUrl: run.indexSourceUrl,
      indexObjectKey: run.indexObjectKey,
      inspectedDocumentCount,
    }
  }

  async nextReportVersion(runId: string, topicId: string | null): Promise<number> {
    const report = topicId
      ? await this.prisma.topicReport.findUnique({ where: { topicId }, select: { latestVersion: true } })
      : await this.prisma.topicReport.findFirst({ where: { scanRunId: runId, topicId: null, card: 'K6' }, select: { latestVersion: true } })
    return (report?.latestVersion ?? 0) + 1
  }

  async createReportRevision(input: CreateTopicReportRevisionInput) {
    return this.prisma.$transaction(async (tx) => {
      let report = input.topicId
        ? await tx.topicReport.findUnique({ where: { topicId: input.topicId } })
        : await tx.topicReport.findFirst({ where: { scanRunId: input.scanRunId, topicId: null, card: 'K6' } })
      report ??= await tx.topicReport.create({
        data: {
          scanRunId: input.scanRunId,
          topicId: input.topicId,
          title: input.title,
          basename: input.basename,
          card: input.card,
        },
      })
      const revision = await tx.reportRevision.create({
        data: {
          reportId: report.id,
          analysisRevisionId: input.analysisRevisionId,
          version: input.version,
          status: 'VALIDATED',
          card: input.card,
          specObjectKey: input.specObjectKey,
          htmlObjectKey: input.htmlObjectKey,
        },
      })
      await tx.topicReport.update({
        where: { id: report.id },
        data: { title: input.title, basename: input.basename, card: input.card, latestVersion: input.version },
      })
      if (input.topicId) await tx.topicProcess.update({ where: { id: input.topicId }, data: { status: 'COMPLETED' } })
      return {
        id: report.id,
        revisionId: revision.id,
        topicId: input.topicId,
        version: revision.version,
        basename: input.basename,
        card: input.card,
        specObjectKey: input.specObjectKey,
        htmlObjectKey: input.htmlObjectKey,
      }
    }, { isolationLevel: 'Serializable' })
  }

  async markTopicRendering(topicId: string): Promise<void> {
    await this.prisma.topicProcess.update({ where: { id: topicId }, data: { status: 'RENDERING' } })
  }

  async markTopicValidating(topicId: string): Promise<void> {
    await this.prisma.topicProcess.update({ where: { id: topicId }, data: { status: 'VALIDATING' } })
  }

  async markTopicCompleted(topicId: string): Promise<void> {
    await this.prisma.topicProcess.update({ where: { id: topicId }, data: { status: 'COMPLETED' } })
  }

  async createAnalysisRevision(input: CreateTopicAnalysisRevisionInput) {
    return this.prisma.$transaction(async (tx) => {
      const revision = await tx.analysisRevision.create({
        data: {
          topicId: input.topicId,
          version: input.version,
          status: input.status,
          analysisObjectKey: input.analysisObjectKey,
          markdownObjectKey: input.markdownObjectKey,
          model: input.model,
          promptVersion: input.promptVersion,
          schemaVersion: input.schemaVersion,
          inputTokens: input.inputTokens ?? null,
          outputTokens: input.outputTokens ?? null,
        },
      })
      await tx.topicProcess.update({
        where: { id: input.topicId },
        data: { status: 'ANALYZED', lastErrorCategory: null, lastErrorMessage: null },
      })
      return revision
    }, { isolationLevel: 'Serializable' })
  }

  async getTopic(topicId: string) {
    return this.prisma.topicProcess.findUnique({
      where: { id: topicId },
      include: {
        evidenceBundle: true,
        thread: { include: { messages: { orderBy: { createdAt: 'asc' } } } },
        analyses: { orderBy: { version: 'asc' } },
        reports: { include: { revisions: { orderBy: { version: 'asc' } } } },
      },
    })
  }

  async getTopicDetail(topicId: string) {
    const topic = await this.prisma.topicProcess.findUnique({
      where: { id: topicId },
      include: {
        document: { select: { title: true, sourceUrl: true } },
        thread: { include: { messages: { orderBy: { createdAt: 'asc' } } } },
        analyses: { orderBy: { version: 'asc' } },
        reports: { include: { revisions: { orderBy: { version: 'asc' } } } },
      },
    })
    return topic ? mapTopicDetail(topic) : null
  }

  async listRunTopicDetails(runId: string) {
    const topics = await this.prisma.topicProcess.findMany({
      where: { scanRunId: runId },
      orderBy: [{ document: { edition: { discoveryOrder: 'asc' } } }, { document: { publicationOrder: 'asc' } }],
      include: {
        document: { select: { title: true, sourceUrl: true } },
        thread: { include: { messages: { orderBy: { createdAt: 'asc' } } } },
        analyses: { orderBy: { version: 'asc' } },
        reports: { include: { revisions: { orderBy: { version: 'asc' } } } },
      },
    })
    return topics.map(mapTopicDetail)
  }

  async appendRevisionRequest(input: { topicId: string; requestKey: string; message: string; revisionKind: 'ANALYSIS' | 'PUBLICATION' }) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.chatMessage.findUnique({ where: { requestKey: input.requestKey } })
      if (existing) {
        if (existing.threadId !== (await tx.analysisThread.findUnique({ where: { topicId: input.topicId } }))?.id) throw new TopicCommandConflictError('Idempotency key başka bir topic için kullanılmış.')
        return { messageId: existing.id, status: 'QUEUED' as const, revisionKind: existing.revisionKind ?? input.revisionKind }
      }
      const thread = await tx.analysisThread.findUnique({ where: { topicId: input.topicId } })
      if (!thread) throw new TopicNotFoundError('Topic bulunamadı.')
      const message = await tx.chatMessage.create({
        data: { threadId: thread.id, role: 'USER', kind: 'REVISION_REQUEST', revisionKind: input.revisionKind, requestKey: input.requestKey, content: input.message },
      })
      await tx.topicOutbox.create({
        data: {
          topicId: input.topicId,
          command: input.revisionKind === 'ANALYSIS' ? 'REVISE_ANALYSIS' : 'REVISE_PUBLICATION',
          requestKey: `message:${input.requestKey}`,
          messageId: message.id,
        },
      })
      return { messageId: message.id, status: 'QUEUED' as const, revisionKind: input.revisionKind }
    })
  }

  async requestTopicRetry(topicId: string, requestKey: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.topicOutbox.findUnique({ where: { requestKey: `retry:${requestKey}` } })
      if (existing) {
        if (existing.topicId !== topicId || existing.command !== 'RETRY_ANALYSIS') throw new TopicCommandConflictError('Idempotency key başka bir komuta ait.')
        return { topicId, commandId: existing.id, status: 'QUEUED' as const }
      }
      const topic = await tx.topicProcess.findUnique({ where: { id: topicId } })
      if (!topic) throw new TopicNotFoundError('Topic bulunamadı.')
      if (topic.status !== 'AWAITING_RETRY') throw new TopicRetryConflictError('Topic yeniden denenmeye hazır değil.')
      const command = await tx.topicOutbox.create({ data: { topicId, command: 'RETRY_ANALYSIS', requestKey: `retry:${requestKey}` } })
      await tx.topicProcess.update({ where: { id: topicId }, data: { status: 'QUEUED', lastErrorCategory: null, lastErrorMessage: null } })
      return { topicId, commandId: command.id, status: 'QUEUED' as const }
    })
  }

  async getTopicReportHtmlKey(topicId: string, version: number): Promise<string | null> {
    const revision = await this.prisma.reportRevision.findFirst({
      where: { report: { topicId }, version, status: 'VALIDATED' },
      select: { htmlObjectKey: true },
    })
    return revision?.htmlObjectKey ?? null
  }

  async getRunReportHtmlKey(runId: string, reportId: string): Promise<string | null> {
    const report = await this.prisma.topicReport.findFirst({
      where: { id: reportId, scanRunId: runId },
      select: {
        revisions: {
          where: { status: 'VALIDATED' },
          orderBy: { version: 'desc' },
          take: 1,
          select: { htmlObjectKey: true },
        },
      },
    })
    return report?.revisions[0]?.htmlObjectKey ?? null
  }

  async getTopicRevisionWorkItem(topicId: string, messageId: string) {
    const topic = await this.prisma.topicProcess.findUnique({
      where: { id: topicId },
      include: {
        analyses: { orderBy: { version: 'desc' }, take: 1 },
        thread: { include: { messages: { orderBy: { createdAt: 'asc' } } } },
        reports: { include: { revisions: { orderBy: { version: 'desc' }, take: 1 } } },
      },
    })
    const message = topic?.thread?.messages.find((item) => item.id === messageId)
    const analysis = topic?.analyses[0]
    if (!topic || !message || !analysis) return null
    const latestReport = topic.reports.flatMap((report) => report.revisions.map((revision) => ({ report, revision })))[0] ?? null
    return {
      topicId: topic.id,
      runId: topic.scanRunId,
      message: { id: message.id, content: message.content, revisionKind: message.revisionKind ?? 'ANALYSIS' },
      recentMessages: topic.thread!.messages.map((item) => ({ role: item.role, content: item.content })),
      latestAnalysis: {
        id: analysis.id, version: analysis.version, status: analysis.status,
        analysisObjectKey: analysis.analysisObjectKey, markdownObjectKey: analysis.markdownObjectKey,
      },
      latestReport: latestReport ? {
        version: latestReport.revision.version,
        basename: latestReport.report.basename,
        specObjectKey: latestReport.revision.specObjectKey,
      } : null,
    }
  }

  async getTopicSequence(topicId: string): Promise<number> {
    const topic = await this.prisma.topicProcess.findUnique({ where: { id: topicId }, select: { scanRunId: true } })
    if (!topic) throw new TopicNotFoundError('Topic bulunamadı.')
    const topics = await this.prisma.topicProcess.findMany({
      where: { scanRunId: topic.scanRunId },
      orderBy: [{ document: { edition: { discoveryOrder: 'asc' } } }, { document: { publicationOrder: 'asc' } }],
      select: { id: true },
    })
    const index = topics.findIndex((item) => item.id === topicId)
    if (index < 0) throw new TopicNotFoundError('Topic sırası bulunamadı.')
    return index + 1
  }

  async canFinalizeRunAfterTopicRetry(runId: string): Promise<boolean> {
    const topics = await this.prisma.topicProcess.findMany({
      where: { scanRunId: runId },
      include: {
        analyses: { orderBy: { version: 'desc' }, take: 1, select: { status: true } },
        reports: { include: { revisions: { where: { status: 'VALIDATED' }, take: 1, select: { id: true } } } },
      },
    })
    return topics.length > 0 && topics.every((topic) => {
      if (topic.status !== 'COMPLETED') return false
      const latestAnalysis = topic.analyses[0]
      if (!latestAnalysis) return false
      return latestAnalysis.status === 'PASS_NO_RELEVANT_CONTENT'
        || topic.reports.some((report) => report.revisions.length > 0)
    })
  }

  async appendRevisionResult(topicId: string, input: { role: 'ASSISTANT' | 'SYSTEM'; kind: 'REVISION_RESULT' | 'ERROR'; revisionKind: 'ANALYSIS' | 'PUBLICATION'; content: string }): Promise<void> {
    const thread = await this.prisma.analysisThread.findUnique({ where: { topicId } })
    if (!thread) throw new TopicNotFoundError('Topic konuşması bulunamadı.')
    await this.prisma.chatMessage.create({ data: { threadId: thread.id, ...input } })
  }

  async claimPendingTopicOutbox(limit: number) {
    const leaseUntil = new Date(Date.now() + 60_000)
    return this.prisma.$queryRaw<Array<{ id: string; topicId: string; command: 'RETRY_ANALYSIS' | 'REVISE_ANALYSIS' | 'REVISE_PUBLICATION'; messageId: string | null; attempts: number }>>(Prisma.sql`
      WITH candidates AS (
        SELECT id FROM "TopicOutbox"
        WHERE "dispatchedAt" IS NULL AND "availableAt" <= NOW()
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "TopicOutbox" AS outbox
      SET "availableAt" = ${leaseUntil}, attempts = outbox.attempts + 1
      FROM candidates
      WHERE outbox.id = candidates.id
      RETURNING outbox.id, outbox."topicId", outbox.command, outbox."messageId", outbox.attempts
    `)
  }

  async markTopicOutboxDispatched(id: string): Promise<void> {
    await this.prisma.topicOutbox.update({ where: { id }, data: { dispatchedAt: new Date(), lastError: null } })
  }

  async deferTopicOutbox(id: string, error: string, availableAt: Date): Promise<void> {
    await this.prisma.topicOutbox.update({ where: { id }, data: { lastError: error, availableAt } })
  }
}

function mapStoredObject(object: { objectKey: string; sha256: string; mediaType: string; byteSize: bigint }): TopicStoredObject {
  return { objectKey: object.objectKey, sha256: object.sha256, mediaType: object.mediaType, byteSize: object.byteSize }
}

function mapAsset(asset: {
  id: string
  sourceUrl: string
  role: TopicEvidenceAsset['role']
  storedObject: { objectKey: string; sha256: string; mediaType: string; byteSize: bigint } | null
}): TopicEvidenceAsset[] {
  return asset.storedObject ? [{ id: asset.id, sourceUrl: asset.sourceUrl, role: asset.role, object: mapStoredObject(asset.storedObject) }] : []
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function mapTopicDetail(topic: any) {
  const analyses = topic.analyses.map((analysis: any) => ({
    id: analysis.id, version: analysis.version, status: analysis.status,
    analysisObjectKey: analysis.analysisObjectKey, markdownObjectKey: analysis.markdownObjectKey,
    model: analysis.model, promptVersion: analysis.promptVersion, schemaVersion: analysis.schemaVersion,
    inputTokens: analysis.inputTokens, outputTokens: analysis.outputTokens, createdAt: analysis.createdAt.toISOString(),
  }))
  const reportRevisions = topic.reports.flatMap((report: any) => report.revisions.map((revision: any) => ({
    id: revision.id, reportId: report.id, version: revision.version, status: revision.status, card: revision.card,
    basename: report.basename, analysisRevisionId: revision.analysisRevisionId,
    specObjectKey: revision.specObjectKey, htmlObjectKey: revision.htmlObjectKey, createdAt: revision.createdAt.toISOString(),
  }))).sort((left: any, right: any) => left.version - right.version)
  const latestAnalysis = analyses.at(-1) ?? null
  const latestReport = reportRevisions.at(-1) ?? null
  return {
    id: topic.id,
    runId: topic.scanRunId,
    documentId: topic.documentId,
    title: topic.document.title,
    sourceUrl: topic.document.sourceUrl,
    status: topic.status,
    retryAvailable: topic.status === 'AWAITING_RETRY',
    errorCategory: topic.lastErrorCategory,
    errorMessage: topic.lastErrorMessage,
    latestAnalysis,
    latestReport,
    analyses,
    reports: reportRevisions,
    thread: {
      id: topic.thread?.id ?? null,
      messages: (topic.thread?.messages ?? []).map((message: any) => ({
        id: message.id, role: message.role, kind: message.kind, revisionKind: message.revisionKind,
        content: message.content, createdAt: message.createdAt.toISOString(),
      })),
    },
  }
}

export class TopicNotFoundError extends Error { override readonly name = 'TopicNotFoundError' }
export class TopicRetryConflictError extends Error { override readonly name = 'TopicRetryConflictError' }
export class TopicCommandConflictError extends Error { override readonly name = 'TopicCommandConflictError' }
