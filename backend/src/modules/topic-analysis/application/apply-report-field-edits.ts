import { ReportSpecSchema, type ReportSpec } from '../domain/report-spec-schemas'
import { applyReportPatch, type ReportPatch } from '../domain/report-patch'
import type { ReportDraftRecord, ReportDraftRepository, TopicObjectStore } from './ports'
import { renderReportHtml } from './render-report-html'

export class ReportDraftConflictError extends Error {
  constructor(readonly currentVersion: number, message: string) {
    super(message)
    this.name = 'ReportDraftConflictError'
  }
}

export class ReportNotPublishedError extends Error {}

export interface ApplyReportFieldEditsInput {
  topicId: string
  patch: ReportPatch
  /** The revision the caller was looking at; a mismatch means the report moved on. */
  expectedVersion?: number
  requestKey: string | null
  source: 'USER' | 'AI'
  prompt: string | null
  chatMessageId: string | null
  actor: string | null
}

export interface ReportDraftView {
  draft: ReportDraftRecord
  spec: ReportSpec
  html: string
}

interface Dependencies {
  repository: ReportDraftRepository
  objectStore: Pick<TopicObjectStore, 'getContent'>
}

/**
 * The single core both revision entry points go through: inline editing in the
 * preview and a patch produced from a prompt. Validation, drift protection and
 * the edit record therefore live in exactly one place.
 */
export async function applyReportFieldEdits(
  input: ApplyReportFieldEditsInput,
  dependencies: Dependencies,
): Promise<ReportDraftView> {
  if (input.requestKey) {
    const replayed = await dependencies.repository.findDraftByRequestKey(input.requestKey)
    // A retried request must not append the same edits twice.
    if (replayed) return toView(replayed)
  }

  const draft = await loadOrOpenDraft(input.topicId, input.actor, dependencies)
  if (input.expectedVersion !== undefined && input.expectedVersion !== draft.baseVersion) {
    throw new ReportDraftConflictError(draft.baseVersion, 'Rapor bu arada güncellendi; taslağı güncel sürüm üzerinden sürdürün.')
  }

  const { spec, applied } = applyReportPatch(ReportSpecSchema.parse(draft.spec), input.patch)
  if (applied.length === 0) return toView(draft)

  const updated = await dependencies.repository.appendEdits({
    draftId: draft.id,
    spec,
    requestKey: input.requestKey,
    source: input.source,
    prompt: input.prompt,
    chatMessageId: input.chatMessageId,
    edits: applied.map((edit) => ({ ...edit, revertsEditId: null })),
  })
  return toView(updated)
}

/** Undoes one edit by appending its inverse, so the history keeps both. */
export async function revertReportFieldEdit(
  input: { topicId: string; editId: string; actor: string | null },
  dependencies: Dependencies,
): Promise<ReportDraftView> {
  const draft = await dependencies.repository.getOpenDraft(input.topicId)
  if (!draft) throw new ReportNotPublishedError('Bu rapor için açık taslak yok.')

  const target = draft.edits.find((edit) => edit.id === input.editId)
  if (!target) throw new ReportNotPublishedError('Geri alınacak değişiklik bulunamadı.')
  if (target.revertedByEditId) return toView(draft)

  const { spec, applied } = applyReportPatch(ReportSpecSchema.parse(draft.spec), {
    edits: [{ path: target.path, value: target.previousValue as string | string[] | null }],
  })
  if (applied.length === 0) return toView(draft)

  const updated = await dependencies.repository.appendEdits({
    draftId: draft.id,
    spec,
    requestKey: null,
    source: 'USER',
    prompt: null,
    chatMessageId: null,
    edits: applied.map((edit) => ({ ...edit, revertsEditId: target.id })),
  })
  return toView(updated)
}

export async function getReportDraftView(
  topicId: string,
  dependencies: Dependencies,
): Promise<ReportDraftView | null> {
  const draft = await dependencies.repository.getOpenDraft(topicId)
  return draft ? toView(draft) : null
}

async function loadOrOpenDraft(
  topicId: string,
  actor: string | null,
  dependencies: Dependencies,
): Promise<ReportDraftRecord> {
  const open = await dependencies.repository.getOpenDraft(topicId)
  if (open) return open

  const base = await dependencies.repository.getPublishedBase(topicId)
  if (!base) throw new ReportNotPublishedError('Bu mevzuat için yayımlanmış bir bülten yok.')

  const spec = JSON.parse((await dependencies.objectStore.getContent(base.specObjectKey)).toString('utf8')) as unknown
  return dependencies.repository.openDraft({
    topicId,
    baseVersion: base.version,
    spec: ReportSpecSchema.parse(spec),
    createdBy: actor,
  })
}

async function toView(draft: ReportDraftRecord): Promise<ReportDraftView> {
  const spec = ReportSpecSchema.parse(draft.spec)
  return { draft, spec, html: await renderReportHtml(spec) }
}
