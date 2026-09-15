import { diffReportSpecs } from '../domain/report-patch'
import { ReportSpecSchema, type ReportSpec } from '../domain/report-spec-schemas'
import type { ReportDraftRepository, TopicObjectStore } from './ports'

interface Dependencies {
  repository: ReportDraftRepository
  objectStore: Pick<TopicObjectStore, 'getContent'>
}

export interface StageAnalysisInput {
  topicId: string
  /** The report spec the analysis revision produced. */
  spec: ReportSpec
  analysisRevisionId: string
  prompt: string | null
  chatMessageId: string | null
}

/**
 * Puts an analysis revision's result into the draft instead of publishing it.
 *
 * A revision is the user's decision: nothing becomes one until they approve. An
 * analysis revision used to publish straight away, so revisions appeared that
 * nobody asked for and — because the open draft was rendered over them — were
 * invisible until publishing failed.
 *
 * The result is staged as the difference against what the user is looking at, so
 * they review named changes rather than an opaque new document.
 */
export async function stageAnalysisInDraft(
  input: StageAnalysisInput,
  dependencies: Dependencies,
): Promise<{ stagedChanges: number }> {
  const base = await dependencies.repository.getPublishedBase(input.topicId)
  if (!base) throw new Error('Bu mevzuat için yayımlanmış bir bülten yok.')

  const open = await dependencies.repository.getOpenDraft(input.topicId)
  const current = open
    ? ReportSpecSchema.parse(open.spec)
    : ReportSpecSchema.parse(JSON.parse((await dependencies.objectStore.getContent(base.specObjectKey)).toString('utf8')))

  const differences = diffReportSpecs(current, input.spec)
  if (differences.length === 0) return { stagedChanges: 0 }

  const draft = open ?? await dependencies.repository.openDraft({
    topicId: input.topicId,
    baseVersion: base.version,
    spec: current,
    createdBy: null,
  })

  await dependencies.repository.appendEdits({
    draftId: draft.id,
    spec: input.spec,
    requestKey: input.chatMessageId ? `analysis-stage:${input.chatMessageId}` : null,
    source: 'AI',
    prompt: input.prompt,
    chatMessageId: input.chatMessageId,
    edits: differences.map((difference) => ({
      path: difference.path,
      previousValue: difference.previousValue,
      nextValue: difference.nextValue,
      revertsEditId: null,
    })),
  })

  // Publishing must bind the report to the analysis it was rendered from, not to
  // the older one the draft started on.
  await dependencies.repository.setDraftAnalysisRevision(draft.id, input.analysisRevisionId)
  return { stagedChanges: differences.length }
}
