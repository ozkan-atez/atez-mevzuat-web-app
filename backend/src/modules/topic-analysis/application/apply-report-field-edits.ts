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
  /** Null while the report still matches its published revision. */
  draft: ReportDraftRecord | null
  baseVersion: number
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
    if (replayed) return toView({ draft: replayed, baseVersion: replayed.baseVersion, spec: ReportSpecSchema.parse(replayed.spec) })
  }

  const current = await loadCurrent(input.topicId, dependencies)
  if (input.expectedVersion !== undefined && input.expectedVersion !== current.baseVersion) {
    throw new ReportDraftConflictError(current.baseVersion, 'Rapor bu arada güncellendi; taslağı güncel sürüm üzerinden sürdürün.')
  }

  // Applied before anything is written, so a rejected patch cannot leave an empty
  // draft — and therefore cannot block the report with a draft nobody asked for.
  const { spec, applied } = applyReportPatch(current.spec, input.patch)
  if (applied.length === 0) return toView(current)

  const draft = current.draft ?? await dependencies.repository.openDraft({
    topicId: input.topicId,
    baseVersion: current.baseVersion,
    spec: current.spec,
    createdBy: input.actor,
  })

  const updated = await dependencies.repository.appendEdits({
    draftId: draft.id,
    spec,
    requestKey: input.requestKey,
    source: input.source,
    prompt: input.prompt,
    chatMessageId: input.chatMessageId,
    edits: applied.map((edit) => ({ ...edit, revertsEditId: null })),
  })
  return toView({ draft: updated, baseVersion: updated.baseVersion, spec })
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
  if (target.revertedByEditId) return toView({ draft, baseVersion: draft.baseVersion, spec: ReportSpecSchema.parse(draft.spec) })

  const { spec, applied } = applyReportPatch(ReportSpecSchema.parse(draft.spec), {
    edits: [{ path: target.path, value: target.previousValue as string | string[] | null }],
  })
  if (applied.length === 0) return toView({ draft, baseVersion: draft.baseVersion, spec: ReportSpecSchema.parse(draft.spec) })

  const updated = await dependencies.repository.appendEdits({
    draftId: draft.id,
    spec,
    requestKey: null,
    source: 'USER',
    prompt: null,
    chatMessageId: null,
    edits: applied.map((edit) => ({ ...edit, revertsEditId: target.id })),
  })
  return toView({ draft: updated, baseVersion: updated.baseVersion, spec })
}

/** The spec the user is looking at: the open draft if there is one, else the published revision. */
export async function getReportDraftView(
  topicId: string,
  dependencies: Dependencies,
): Promise<ReportDraftView | null> {
  const draft = await dependencies.repository.getOpenDraft(topicId)
  if (draft) return toView({ draft, baseVersion: draft.baseVersion, spec: ReportSpecSchema.parse(draft.spec) })

  const base = await dependencies.repository.getPublishedBase(topicId)
  if (!base) return null
  return toView({ draft: null, baseVersion: base.version, spec: await loadSpec(base.specObjectKey, dependencies) })
}

async function loadCurrent(
  topicId: string,
  dependencies: Dependencies,
): Promise<{ draft: ReportDraftRecord | null; baseVersion: number; spec: ReportSpec }> {
  const draft = await dependencies.repository.getOpenDraft(topicId)
  if (draft) return { draft, baseVersion: draft.baseVersion, spec: ReportSpecSchema.parse(draft.spec) }

  const base = await dependencies.repository.getPublishedBase(topicId)
  if (!base) throw new ReportNotPublishedError('Bu mevzuat için yayımlanmış bir bülten yok.')
  return { draft: null, baseVersion: base.version, spec: await loadSpec(base.specObjectKey, dependencies) }
}

async function loadSpec(specObjectKey: string, dependencies: Dependencies): Promise<ReportSpec> {
  const raw = JSON.parse((await dependencies.objectStore.getContent(specObjectKey)).toString('utf8')) as unknown
  return ReportSpecSchema.parse(raw)
}

async function toView(input: { draft: ReportDraftRecord | null; baseVersion: number; spec: ReportSpec }): Promise<ReportDraftView> {
  return { ...input, html: await renderReportHtml(input.spec) }
}
