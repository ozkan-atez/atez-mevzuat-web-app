import { createHash } from 'node:crypto'
import type { AiModelClient } from '../../ai/application/ai-model-client'
import { AiProviderError } from '../../ai/domain/ai-errors'
import { ReportPatchError, type ReportFieldEdit } from '../domain/report-patch'
import { ReportSpecSchema, type ReportSpec } from '../domain/report-spec-schemas'
import type { ReportDraftRepository, TopicObjectStore } from './ports'
import {
  PatchResponseSchema,
  REPORT_PATCH_PROMPT_VERSION,
  buildPatchPromptParts,
  buildPatchSystemInstruction,
  patchResponseJsonSchema,
} from './patch-prompts'
import { applyReportFieldEdits, getReportDraftView } from './apply-report-field-edits'

interface RevisionRecorder {
  startTopicAiExecution(input: {
    topicId: string
    kind: 'INITIAL_ANALYSIS' | 'ANALYSIS_REVISION' | 'PUBLICATION_REVISION'
    attemptNo: number
    model: string
    promptVersion: string
    schemaVersion: number
    inputHash: string
    requestMessageId?: string
  }): Promise<{ id: string }>
  completeTopicAiExecution(id: string, input: {
    analysisRevisionId?: string
    providerRequestId: string | null
    latencyMs: number
    inputTokens: number | null
    outputTokens: number | null
  }): Promise<void>
  failTopicAiExecution(id: string, error: { category: string; providerStatus: number | null; message: string }): Promise<void>
  appendRevisionResult(topicId: string, input: {
    role: 'ASSISTANT' | 'SYSTEM'
    kind: 'REVISION_RESULT' | 'ERROR'
    revisionKind: 'ANALYSIS' | 'PUBLICATION' | 'DIRECT_EDIT'
    content: string
    requestKey?: string
  }): Promise<void>
  getTopicRevisionMessage(topicId: string, messageId: string): Promise<{ id: string; content: string } | null>
}

interface Dependencies {
  repository: RevisionRecorder
  draftRepository: ReportDraftRepository
  objectStore: Pick<TopicObjectStore, 'getContent'>
  aiModel: AiModelClient
  model: string
}

/**
 * Turns a chat request into a field patch and applies it through the same core
 * the inline editor uses. The model never writes the report: it only names which
 * fields change, so a prompt cannot reword anything the user did not ask about.
 */
export async function executePromptPatch(
  command: { topicId: string; messageId: string },
  dependencies: Dependencies,
): Promise<void> {
  const message = await dependencies.repository.getTopicRevisionMessage(command.topicId, command.messageId)
  if (!message) throw new Error('Revizyon talebi bulunamadı.')

  const spec = await currentSpec(command.topicId, dependencies)
  if (!spec) {
    await recordOutcome(command.topicId, 'ERROR', 'Bu mevzuat için yayımlanmış bir bülten bulunamadı.', dependencies)
    return
  }

  const execution = await dependencies.repository.startTopicAiExecution({
    topicId: command.topicId,
    kind: 'PUBLICATION_REVISION',
    attemptNo: 1,
    model: dependencies.model,
    promptVersion: REPORT_PATCH_PROMPT_VERSION,
    schemaVersion: 1,
    inputHash: createHash('sha256').update(`${JSON.stringify(spec)}\n${message.content}\n${dependencies.model}`).digest('hex'),
    requestMessageId: message.id,
  })

  const startedAt = Date.now()
  let response
  try {
    response = await dependencies.aiModel.generateStructured({
      model: dependencies.model,
      systemInstruction: buildPatchSystemInstruction(),
      parts: buildPatchPromptParts({ spec, request: message.content }),
      responseJsonSchema: patchResponseJsonSchema,
    })
  } catch (error) {
    const failure = error instanceof AiProviderError
      ? { category: error.category, providerStatus: error.providerStatus, message: error.message }
      : { category: 'INVALID_RESPONSE', providerStatus: null, message: 'Revizyon isteği tamamlanamadı.' }
    await dependencies.repository.failTopicAiExecution(execution.id, failure)
    await recordOutcome(command.topicId, 'ERROR', failure.message, dependencies)
    return
  }

  const parsed = PatchResponseSchema.safeParse(response.json)
  if (!parsed.success) {
    await dependencies.repository.failTopicAiExecution(execution.id, {
      category: 'INVALID_RESPONSE', providerStatus: null, message: 'Model geçerli bir değişiklik listesi döndürmedi.',
    })
    await recordOutcome(command.topicId, 'ERROR', 'Model geçerli bir değişiklik listesi döndürmedi.', dependencies)
    return
  }

  await dependencies.repository.completeTopicAiExecution(execution.id, {
    providerRequestId: response.providerRequestId,
    latencyMs: Date.now() - startedAt,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
  })

  if (parsed.data.outcome === 'NEEDS_ANALYSIS') {
    await recordOutcome(command.topicId, 'REVISION_RESULT',
      parsed.data.reason ?? 'Bu talep kanıtlı bir olguyu değiştiriyor; alan düzenlemesiyle karşılanamaz, analiz revizyonu gerekir.',
      dependencies)
    return
  }
  if (parsed.data.outcome === 'NOT_POSSIBLE' || !parsed.data.edits?.length) {
    await recordOutcome(command.topicId, 'REVISION_RESULT',
      parsed.data.reason ?? 'Talep, düzenlenebilir alanlarla karşılanamadı.', dependencies)
    return
  }

  const edits: ReportFieldEdit[] = parsed.data.edits.map((edit) => ({
    path: edit.path,
    value: edit.clear ? null : edit.value,
  }))

  try {
    const view = await applyReportFieldEdits({
      topicId: command.topicId,
      patch: { edits },
      requestKey: `patch:${message.id}`,
      source: 'AI',
      prompt: message.content,
      chatMessageId: message.id,
      actor: null,
    }, { repository: dependencies.draftRepository, objectStore: dependencies.objectStore })

    await recordOutcome(command.topicId, 'REVISION_RESULT',
      `${view.draft?.edits.length ?? 0} değişiklik taslağa eklendi.`, dependencies, `patch-result:${message.id}`)
  } catch (error) {
    // A model that proposes a locked field is corrected, not retried blindly.
    const reason = error instanceof ReportPatchError
      ? error.message
      : 'Değişiklikler uygulanamadı.'
    await recordOutcome(command.topicId, 'ERROR', reason, dependencies, `patch-error:${message.id}`)
  }
}

async function currentSpec(topicId: string, dependencies: Dependencies): Promise<ReportSpec | null> {
  const draft = await getReportDraftView(topicId, { repository: dependencies.draftRepository, objectStore: dependencies.objectStore })
  if (draft) return draft.spec

  const base = await dependencies.draftRepository.getPublishedBase(topicId)
  if (!base) return null
  return ReportSpecSchema.parse(JSON.parse((await dependencies.objectStore.getContent(base.specObjectKey)).toString('utf8')))
}

async function recordOutcome(
  topicId: string,
  kind: 'REVISION_RESULT' | 'ERROR',
  content: string,
  dependencies: Dependencies,
  requestKey?: string,
): Promise<void> {
  await dependencies.repository.appendRevisionResult(topicId, {
    role: 'ASSISTANT', kind, revisionKind: 'DIRECT_EDIT', content,
    ...(requestKey ? { requestKey } : {}),
  })
}
