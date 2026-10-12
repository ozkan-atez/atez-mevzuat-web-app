import { getActorContext, resourceOwnership, reportAccessWhere } from '../../../platform/actor-context'
import { Prisma, type PrismaClient } from '@prisma/client'
import type { PublishedReportBase, ReportDraftRecord, ReportDraftRepository } from '../application/ports'
import { matchEditablePattern } from '../domain/report-patch'

export class DraftConflictError extends Error {}

export class PrismaReportDraftRepository implements ReportDraftRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getPublishedBase(topicId: string): Promise<PublishedReportBase | null> {
    const revision = await this.prisma.reportRevision.findFirst({
      where: { report: { AND: [reportAccessWhere()], OR: [{ topicId }, { id: topicId, topicId: null, card: 'K6' }] }, status: 'VALIDATED' },
      orderBy: { version: 'desc' },
      select: {
        version: true,
        specObjectKey: true,
        analysisRevisionId: true,
        report: {
          select: {
            basename: true,
            scanRunId: true,
            scanRun: { select: { targetDate: true } },
            topic: { select: { document: { select: { edition: { select: { publicationDate: true } } } } } },
          },
        },
      },
    })
    const topic = revision?.report.topic
    if (!revision || !revision.report.scanRunId) return null
    return {
      runId: revision.report.scanRunId,
      targetDate: toIsoDate(topic?.document.edition.publicationDate ?? revision.report.scanRun!.targetDate),
      version: revision.version,
      analysisRevisionId: revision.analysisRevisionId,
      basename: revision.report.basename,
      specObjectKey: revision.specObjectKey,
    }
  }

  async getPublishedHistory(topicId:string) {
    const revisions=await this.prisma.reportRevision.findMany({where:{report:{AND:[reportAccessWhere()],OR:[{topicId},{id:topicId,topicId:null,card:'K6'}]},status:'VALIDATED',draftId:{not:null}},orderBy:{version:'desc'},take:20,include:{draft:{include:{edits:{orderBy:{sequence:'asc'}}}}}})
    return revisions.filter(r=>(r.draft?.topicId ?? r.draft?.reportId)===topicId).map(r=>({version:r.version,createdAt:r.createdAt.toISOString(),edits:mapDraft(r.draft!).edits.map(e=>({...e,revertible:false}))}))
  }

  async getOpenDraft(topicId: string): Promise<ReportDraftRecord | null> {
    const draft = await this.prisma.reportDraft.findFirst({
      where: { AND: [reportAccessWhere()], OR: [{ topicId }, { reportId: topicId }], status: 'OPEN' },
      include: { edits: { orderBy: { sequence: 'asc' } } },
    })
    return draft ? mapDraft(draft) : null
  }

  async openDraft(input: { topicId: string; baseVersion: number; spec: unknown; createdBy: string | null }): Promise<ReportDraftRecord> {
    const report = await this.prisma.topicReport.findFirst({where:{AND:[reportAccessWhere()],OR:[{topicId:input.topicId},{id:input.topicId,topicId:null,card:'K6'}]}})
    if (!report) throw new DraftConflictError('Rapor bulunamadı.')
    try {
      const draft = await this.prisma.reportDraft.create({
        data: {
          ...resourceOwnership(true),
          topicId: report.topicId,
          reportId: report.topicId ? null : report.id,
          baseVersion: input.baseVersion,
          specJson: input.spec as Prisma.InputJsonValue,
          createdBy: getActorContext()?.userId ?? input.createdBy,
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
      where: { id: edit.draftId,...reportAccessWhere() },
      include: { edits: { orderBy: { sequence: 'asc' } } },
    })
    return draft ? mapDraft(draft) : null
  }

  /**
   * Appends the edits and the resulting spec in one transaction, so a draft can
   * never carry a spec that does not match its recorded history.
   */
  async appendEdits(input: {
    analysisRevisionId?: string
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
        where: { id: input.draftId,...reportAccessWhere() },
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
        where: { id: input.draftId,...reportAccessWhere() },
        data: { specJson: input.spec as Prisma.InputJsonValue,...(input.analysisRevisionId?{analysisRevisionId:input.analysisRevisionId}:{}) },
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
  topicId: string | null
  reportId?: string | null
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
  if(!draft.topicId && !draft.reportId) throw new DraftConflictError('Bu taslak bağımsız işlem ekranından düzenlenmelidir.')
  const revertedBy = new Map(draft.edits.filter((edit) => edit.revertsEditId).map((edit) => [edit.revertsEditId as string, edit.id]))
  return {
    id: draft.id,
    topicId: (draft.topicId ?? draft.reportId)!,
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
