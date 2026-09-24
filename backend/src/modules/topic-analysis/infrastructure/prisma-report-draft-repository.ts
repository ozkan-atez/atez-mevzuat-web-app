import { Prisma, type PrismaClient } from '@prisma/client'
import type { PublishedReportBase, ReportDraftRecord, ReportDraftRepository } from '../application/ports'
import { matchEditablePattern } from '../domain/report-patch'

export class DraftConflictError extends Error {}

export class PrismaReportDraftRepository implements ReportDraftRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getPublishedBase(topicId: string): Promise<PublishedReportBase | null> {
    const revision = await this.prisma.reportRevision.findFirst({
      where: { report: { topicId }, status: 'VALIDATED' },
      orderBy: { version: 'desc' },
      select: {
        version: true,
        specObjectKey: true,
        analysisRevisionId: true,
        report: {
          select: {
            basename: true,
            scanRunId: true,
            topic: { select: { document: { select: { edition: { select: { publicationDate: true } } } } } },
          },
        },
      },
    })
    const topic = revision?.report.topic
    if (!revision || !topic) return null
    return {
      runId: revision.report.scanRunId,
      targetDate: toIsoDate(topic.document.edition.publicationDate),
      version: revision.version,
      analysisRevisionId: revision.analysisRevisionId,
      basename: revision.report.basename,
      specObjectKey: revision.specObjectKey,
    }
  }

  async getOpenDraft(topicId: string): Promise<ReportDraftRecord | null> {
    const draft = await this.prisma.reportDraft.findFirst({
      where: { topicId, status: 'OPEN' },
      include: { edits: { orderBy: { sequence: 'asc' } } },
    })
    return draft ? mapDraft(draft) : null
  }

  async openDraft(input: { topicId: string; baseVersion: number; spec: unknown; createdBy: string | null }): Promise<ReportDraftRecord> {
    try {
      const draft = await this.prisma.reportDraft.create({
        data: {
          topicId: input.topicId,
          baseVersion: input.baseVersion,
          specJson: input.spec as Prisma.InputJsonValue,
          createdBy: input.createdBy,
        },
        include: { edits: true },
      })
      return mapDraft(draft)
    } catch (error) {
      // The filtered unique index rejects a second open draft; another request won
      // the race, so reuse its draft instead of failing the user's edit.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.getOpenDraft(input.topicId)
        if (existing) return existing
      }
      throw error
    }
  }

  async findDraftByRequestKey(requestKey: string): Promise<ReportDraftRecord | null> {
    const edit = await this.prisma.reportFieldEdit.findUnique({
      where: { requestKey },
      select: { draftId: true },
    })
    if (!edit) return null
    const draft = await this.prisma.reportDraft.findUnique({
      where: { id: edit.draftId },
      include: { edits: { orderBy: { sequence: 'asc' } } },
    })
    return draft ? mapDraft(draft) : null
  }

  /**
   * Appends the edits and the resulting spec in one transaction, so a draft can
   * never carry a spec that does not match its recorded history.
   */
  async appendEdits(input: {
    draftId: string
    spec: unknown
    requestKey: string | null
    source: 'USER' | 'AI'
    prompt: string | null
    chatMessageId: string | null
    edits: Array<{ path: string; previousValue: unknown; nextValue: unknown; revertsEditId: string | null }>
  }): Promise<ReportDraftRecord> {
    const draft = await this.prisma.$transaction(async (tx) => {
      const current = await tx.reportDraft.findUnique({
        where: { id: input.draftId },
        select: { status: true, edits: { orderBy: { sequence: 'desc' }, take: 1, select: { sequence: true } } },
      })
      if (!current) throw new DraftConflictError('Taslak bulunamadı.')
      if (current.status !== 'OPEN') throw new DraftConflictError('Taslak kapanmış; düzenleme eklenemez.')

      const firstSequence = (current.edits[0]?.sequence ?? 0) + 1
      for (const [index, edit] of input.edits.entries()) {
        await tx.reportFieldEdit.create({
          data: {
            draftId: input.draftId,
            sequence: firstSequence + index,
            path: edit.path,
            previousValue: toJson(edit.previousValue),
            nextValue: toJson(edit.nextValue),
            source: input.source,
            prompt: input.prompt,
            chatMessageId: input.chatMessageId,
            // Only the first row of a patch carries the key; one key must not be
            // reusable for a different patch.
            requestKey: index === 0 ? input.requestKey : null,
            revertsEditId: edit.revertsEditId,
          },
        })
      }

      return tx.reportDraft.update({
        where: { id: input.draftId },
        data: { specJson: input.spec as Prisma.InputJsonValue },
        include: { edits: { orderBy: { sequence: 'asc' } } },
      })
    })
    return mapDraft(draft)
  }

  async setDraftAnalysisRevision(draftId: string, analysisRevisionId: string): Promise<void> {
    await this.prisma.reportDraft.update({ where: { id: draftId }, data: { analysisRevisionId } })
  }

  async closeDraft(draftId: string, status: 'PUBLISHED' | 'DISCARDED'): Promise<void> {
    await this.prisma.reportDraft.update({
      where: { id: draftId },
      data: { status, closedAt: new Date() },
    })
  }
}

function mapDraft(draft: {
  id: string
  topicId: string
  baseVersion: number
  analysisRevisionId: string | null
  specJson: Prisma.JsonValue
  status: 'OPEN' | 'PUBLISHED' | 'DISCARDED'
  createdAt: Date
  updatedAt: Date
  edits: Array<{
    id: string
    sequence: number
    path: string
    previousValue: Prisma.JsonValue | null
    nextValue: Prisma.JsonValue | null
    source: 'USER' | 'AI'
    prompt: string | null
    chatMessageId: string | null
    revertsEditId: string | null
    createdAt: Date
  }>
}): ReportDraftRecord {
  const revertedBy = new Map(draft.edits.filter((edit) => edit.revertsEditId).map((edit) => [edit.revertsEditId as string, edit.id]))
  return {
    id: draft.id,
    topicId: draft.topicId,
    baseVersion: draft.baseVersion,
    analysisRevisionId: draft.analysisRevisionId,
    spec: draft.specJson,
    status: draft.status,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
    edits: draft.edits.map((edit) => ({
      id: edit.id,
      sequence: edit.sequence,
      path: edit.path,
      previousValue: edit.previousValue,
      nextValue: edit.nextValue,
      source: edit.source,
      prompt: edit.prompt,
      chatMessageId: edit.chatMessageId,
      revertsEditId: edit.revertsEditId,
      revertedByEditId: revertedBy.get(edit.id) ?? null,
      // Derived rather than stored: whether a path is editable is a rule, not a fact
      // about this row, and storing it would let the two drift apart.
      revertible: matchEditablePattern(edit.path) !== null,
      createdAt: edit.createdAt.toISOString(),
    })),
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue)
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}
