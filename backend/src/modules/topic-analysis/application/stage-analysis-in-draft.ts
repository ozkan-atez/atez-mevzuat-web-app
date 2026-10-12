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
  previousSpec?: ReportSpec
  preserveCustomization?: boolean
  stageKind?: 'ANALYSIS' | 'PUBLICATION'
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
  const requestKey=input.chatMessageId?`${input.stageKind==='PUBLICATION'?'publication':'analysis'}-stage:${input.chatMessageId}`:null
  if(requestKey && await dependencies.repository.findDraftByRequestKey(requestKey))return {stagedChanges:0}
  const base = await dependencies.repository.getPublishedBase(input.topicId)
  if (!base) throw new Error('Bu mevzuat için yayımlanmış bir bülten yok.')

  const open = await dependencies.repository.getOpenDraft(input.topicId)
  const current = open
    ? ReportSpecSchema.parse(open.spec)
    : ReportSpecSchema.parse(JSON.parse((await dependencies.objectStore.getContent(base.specObjectKey)).toString('utf8')))

  // Analysis revisions retain the user's layout, source evidence and custom sections.
  const target=ReportSpecSchema.parse({...input.spec,...(input.preserveCustomization!==false?{customization:current.customization}:{})})
  const baseline=input.previousSpec?ReportSpecSchema.parse({...input.previousSpec,...(input.preserveCustomization!==false?{customization:current.customization}:{})}):current
  const revisedSpec=input.previousSpec && baseline.card===target.card?mergeChangedFields(current,baseline,target):target
  const differences = diffReportSpecs(current, revisedSpec)
  if (differences.length === 0) return { stagedChanges: 0 }

  const draft = open ?? await dependencies.repository.openDraft({
    topicId: input.topicId,
    baseVersion: base.version,
    spec: current,
    createdBy: null,
  })

  await dependencies.repository.appendEdits({
    draftId: draft.id,
    analysisRevisionId:input.analysisRevisionId,
    spec: revisedSpec,
    requestKey,
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
  return { stagedChanges: differences.length }
}


/** Apply only fields changed by this analysis; keep unrelated earlier draft edits. */
function mergeChangedFields(current:ReportSpec,baseline:ReportSpec,target:ReportSpec):ReportSpec {
 const merged=JSON.parse(JSON.stringify(current)) as Record<string,unknown>
 for(const change of diffReportSpecs(baseline,target)) {
  const parts=change.path.split('.')
  let source:unknown=target,exists=true
  for(const part of parts){if(!source || typeof source!=='object' || !Object.hasOwn(source,part)){exists=false;break}source=(source as Record<string,unknown>)[part]}
  let destination=merged
  for(const part of parts.slice(0,-1)){if(!destination[part] || typeof destination[part]!=='object')destination[part]={};destination=destination[part] as Record<string,unknown>}
  const key=parts.at(-1)!
  if(exists)destination[key]=JSON.parse(JSON.stringify(source));else delete destination[key]
 }
 return ReportSpecSchema.parse(merged)
}
