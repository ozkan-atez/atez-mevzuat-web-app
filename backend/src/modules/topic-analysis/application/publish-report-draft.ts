import { ReportSpecSchema } from '../domain/report-spec-schemas'
import type { ReportDraftRepository, StoredTopicReport, TopicObjectStore } from './ports'
import type { CreateTopicReportRevisionInput } from './ports'
import { ReportDraftConflictError, ReportNotPublishedError } from './apply-report-field-edits'
import { renderReportHtml } from './render-report-html'
import { validateReportHtml } from './validate-report-html'

interface ReportRevisionWriter {
  createReportRevision(input: CreateTopicReportRevisionInput): Promise<StoredTopicReport>
}

interface Dependencies {
  repository: ReportDraftRepository
  topicRepository: ReportRevisionWriter
  objectStore: Pick<TopicObjectStore, 'putRunFile'>
}

/**
 * Turns every edit accumulated in the draft into exactly one new immutable
 * revision. No new analysis revision is created: a field edit changes how the
 * bulletin reads, not what the evidence says, so the new report stays attached
 * to the analysis it was rendered from.
 */
export async function publishReportDraft(
  input: { topicId: string; expectedVersion?: number },
  dependencies: Dependencies,
): Promise<StoredTopicReport> {
  const draft = await dependencies.repository.getOpenDraft(input.topicId)
  if (!draft) throw new ReportNotPublishedError('Yayımlanacak açık taslak yok.')
  if (draft.edits.length === 0) throw new ReportNotPublishedError('Taslakta yayımlanacak değişiklik yok.')

  const base = await dependencies.repository.getPublishedBase(input.topicId)
  if (!base) throw new ReportNotPublishedError('Bu mevzuat için yayımlanmış bir bülten yok.')

  // The report moved on while the draft was open, so publishing would silently
  // drop whatever that other revision changed.
  if (base.version !== draft.baseVersion) {
    throw new ReportDraftConflictError(base.version, 'Rapor bu arada güncellendi; değişikliklerinizi güncel sürüm üzerinde tekrarlayın.')
  }
  if (input.expectedVersion !== undefined && input.expectedVersion !== draft.baseVersion) {
    throw new ReportDraftConflictError(base.version, 'Rapor bu arada güncellendi; değişikliklerinizi güncel sürüm üzerinde tekrarlayın.')
  }

  const spec = ReportSpecSchema.parse(draft.spec)
  const version = base.version + 1
  const revisionFolder = `r${String(version).padStart(2, '0')}`
  const root = `runs/${base.targetDate.replaceAll('-', '/')}/${base.runId}/topics/${input.topicId}/reports/${revisionFolder}`

  const html = await renderReportHtml(spec)
  validateReportHtml(html, { card: spec.card, topicId: input.topicId, basename: base.basename })

  await dependencies.objectStore.putRunFile(`${root}/report-spec.json`, Buffer.from(JSON.stringify(spec)), 'application/json')
  await dependencies.objectStore.putRunFile(`${root}/${base.basename}`, Buffer.from(html), 'text/html; charset=utf-8')

  const stored = await dependencies.topicRepository.createReportRevision({
    scanRunId: base.runId,
    topicId: input.topicId,
    analysisRevisionId: base.analysisRevisionId,
    title: spec.card === 'K6' ? spec.documentTitle : spec.title,
    basename: base.basename,
    card: spec.card,
    version,
    specObjectKey: `${root}/report-spec.json`,
    htmlObjectKey: `${root}/${base.basename}`,
    draftId: draft.id,
  })

  await dependencies.repository.closeDraft(draft.id, 'PUBLISHED')
  return stored
}

/** Closes the draft without touching any published revision. */
export async function discardReportDraft(
  topicId: string,
  dependencies: Pick<Dependencies, 'repository'>,
): Promise<void> {
  const draft = await dependencies.repository.getOpenDraft(topicId)
  if (!draft) return
  await dependencies.repository.closeDraft(draft.id, 'DISCARDED')
}
