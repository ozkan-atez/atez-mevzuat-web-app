import type { AnalysisRevisionStatus, PrismaClient } from '@prisma/client'

export interface CreateAnalysisRevisionInput {
  topicId: string
  status: AnalysisRevisionStatus
  analysisObjectKey: string
  markdownObjectKey: string
  model: string
  promptVersion: string
  schemaVersion: number
  inputTokens?: number | null
  outputTokens?: number | null
}

export class PrismaTopicAnalysisRepository {
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

  async createAnalysisRevision(input: CreateAnalysisRevisionInput) {
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.analysisRevision.aggregate({
        where: { topicId: input.topicId },
        _max: { version: true },
      })
      const revision = await tx.analysisRevision.create({
        data: {
          topicId: input.topicId,
          version: (latest._max.version ?? 0) + 1,
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
