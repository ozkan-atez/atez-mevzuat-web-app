import { createHash } from 'node:crypto'
import type { AiModelClient } from '../../ai/application/ai-model-client'
import { AiProviderError } from '../../ai/domain/ai-errors'
import { ReportPatchError, type ReportFieldEdit } from '../domain/report-patch'
import { ReportSpecSchema, type ReportSpec } from '../domain/report-spec-schemas'
import type { ReportDraftRepository, TopicObjectStore } from './ports'
import type { PatchResponse } from './patch-prompts'
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
  appendRevisionRequest(input: { topicId: string; requestKey: string; message: string; revisionKind: 'ANALYSIS' | 'DIRECT_EDIT' }): Promise<{ messageId: string; status: 'QUEUED' }>
}

interface Dependencies {
  repository: RevisionRecorder
  draftRepository: ReportDraftRepository
  objectStore: Pick<TopicObjectStore, 'getContent'>
  aiModel: AiModelClient
  model: string
  maxAttempts: number
}

/**
 * Turns a chat request into a field patch and applies it through the same core
 * the inline editor uses. The model never writes the report: it only names which
 * fields change, so a prompt cannot reword anything the user did not ask about.
 */
interface PatchAttempt {
  ok: true
  parsed: { data: PatchResponse }
}

type PatchResult = PatchAttempt | { ok: false; message: string }

/**
 * Retries a provider error the same bounded way the analysis path does. A single
 * attempt made one transient 503 enough to lose the whole request.
 */
async function requestPatch(
  topicId: string,
  message: { id: string; content: string },
  spec: ReportSpec,
  inputHash: string,
  dependencies: Dependencies,
): Promise<PatchResult> {
  let lastMessage = 'Revizyon isteği tamamlanamadı.'

  for (let attemptNo = 1; attemptNo <= Math.max(1, dependencies.maxAttempts); attemptNo += 1) {
    const execution = await dependencies.repository.startTopicAiExecution({
      topicId,
      kind: 'PUBLICATION_REVISION',
      attemptNo,
      model: dependencies.model,
      promptVersion: REPORT_PATCH_PROMPT_VERSION,
      schemaVersion: 1,
      inputHash,
      requestMessageId: message.id,
    })
    const startedAt = Date.now()

    try {
      const response = await dependencies.aiModel.generateStructured({
        model: dependencies.model,
        systemInstruction: buildPatchSystemInstruction(),
        parts: buildPatchPromptParts({ spec, request: message.content }),
        responseJsonSchema: patchResponseJsonSchema,
      })

      const parsed = PatchResponseSchema.safeParse(response.json)
      if (!parsed.success) {
        lastMessage = 'Model geçerli bir değişiklik listesi döndürmedi.'
        await dependencies.repository.failTopicAiExecution(execution.id, {
          category: 'INVALID_RESPONSE', providerStatus: null, message: lastMessage,
        })
        // A malformed response is not a provider outage; asking again blindly would
        // just spend another call on the same prompt.
        return { ok: false, message: lastMessage }
      }

      await dependencies.repository.completeTopicAiExecution(execution.id, {
        providerRequestId: response.providerRequestId,
        latencyMs: Date.now() - startedAt,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      })
      return { ok: true, parsed: { data: parsed.data } }
    } catch (error) {
      const failure = error instanceof AiProviderError
        ? { category: error.category, providerStatus: error.providerStatus, message: error.message }
        : { category: 'INVALID_RESPONSE', providerStatus: null, message: 'Revizyon isteği tamamlanamadı.' }
      lastMessage = failure.message
      await dependencies.repository.failTopicAiExecution(execution.id, failure)
      if (error instanceof AiProviderError && error.retryable && attemptNo < dependencies.maxAttempts) continue
      return { ok: false, message: lastMessage }
    }
  }

  return { ok: false, message: lastMessage }
}

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

  const inputHash = createHash('sha256').update(`${JSON.stringify(spec)}\n${message.content}\n${dependencies.model}`).digest('hex')
  const attempted = await requestPatch(command.topicId, message, spec, inputHash, dependencies)
  if (!attempted.ok) {
    await recordOutcome(command.topicId, 'ERROR', attempted.message, dependencies)
    return
  }
  const parsed = attempted.parsed

  // One message can carry several asks; each is decided on its own so a part that
  // needs analysis no longer sinks the parts that are plain text edits.
  const requests = parsed.data.requests ?? []
  const applicable = (parsed.data.edits ?? []).filter((edit) => {
    const request = edit.requestIndex === undefined ? undefined : requests[edit.requestIndex]
    return request === undefined || request.outcome === 'EDITS'
  })
  const escalations = requests.filter((request) => request.outcome === 'NEEDS_ANALYSIS')
  const refusals = requests.filter((request) => request.outcome === 'NOT_POSSIBLE')

  if (applicable.length === 0) {
    if (escalations.length > 0 || parsed.data.outcome === 'NEEDS_ANALYSIS') {
      // The facts have to move, so the request is handed to the analysis path rather
      // than dropped — the user asked for a change and should get one.
      await dependencies.repository.appendRevisionRequest({
        topicId: command.topicId,
        requestKey: `escalate:${message.id}`,
        message: escalations.length > 0 ? escalations.map((request) => request.summary).join('\n') : message.content,
        revisionKind: 'ANALYSIS',
      })
      await recordOutcome(command.topicId, 'REVISION_RESULT',
        `${escalations[0]?.reason ?? parsed.data.reason ?? 'Bu talep kanıtlı bir olguyu değiştiriyor.'} Alan düzenlemesiyle karşılanamadığı için analiz revizyonu başlatıldı; sonuç kanıtın desteklediği kadarıyla oluşur ve değişiklik listesinde alan kaydı bırakmaz.`,
        dependencies, `escalated:${message.id}`)
      return
    }
    await recordOutcome(command.topicId, 'REVISION_RESULT',
      refusals[0]?.reason ?? parsed.data.reason ?? 'Talep, düzenlenebilir alanlarla karşılanamadı.', dependencies)
    return
  }

  // Part of the message is an edit and part needs evidence: apply what can be
  // applied now and let the analysis path pick up the rest.
  if (escalations.length > 0) {
    await dependencies.repository.appendRevisionRequest({
      topicId: command.topicId,
      requestKey: `escalate:${message.id}`,
      message: escalations.map((request) => request.summary).join('\n'),
      revisionKind: 'ANALYSIS',
    })
  }

  const edits: ReportFieldEdit[] = applicable.map((edit) => ({
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

    // The model may have handled part of a mixed request; the rest must be said out
    // loud or the reader assumes everything they asked for was done.
    const notes = [
      ...escalations.map((request) => `Analiz revizyonuna aktarıldı: ${request.summary}`),
      ...refusals.map((request) => `Yapılamayan kısım: ${request.reason ?? request.summary}`),
    ]
    if (notes.length === 0 && parsed.data.reason) notes.push(`Yapılamayan kısım: ${parsed.data.reason}`)
    const remark = notes.length > 0 ? ` ${notes.join(' ')}` : ''
    await recordOutcome(command.topicId, 'REVISION_RESULT',
      `${view.draft?.edits.length ?? 0} değişiklik taslağa eklendi.${remark}`, dependencies, `patch-result:${message.id}`)
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
