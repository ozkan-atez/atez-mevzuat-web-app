import type { PrismaClient } from '@prisma/client'
import type { AiCallFailure } from '../../scan-runs/application/ports'
import type {
  CreateTopicAnalysisRevisionInput,
  TopicAnalysisRepository,
  TopicEvidenceAsset,
  TopicEvidenceInput,
  TopicStoredObject,
} from '../application/ports'

export class PrismaTopicAnalysisRepository implements TopicAnalysisRepository {
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
