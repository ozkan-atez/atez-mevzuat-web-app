import { createHash } from 'node:crypto'
import { ZodError } from 'zod'
import type { AiModelClient } from '../../ai/application/ai-model-client'
import { AiProviderError } from '../../ai/domain/ai-errors'
import type { AiCallFailure } from '../../scan-runs/application/ports'
import { AnalysisResultSchema } from '../domain/analysis-schemas'
import { buildEvidenceBundle } from './build-evidence-bundle'
import {
  analysisResponseJsonSchema,
  buildTopicAnalysisSystemInstruction,
  TOPIC_ANALYSIS_PROMPT_VERSION,
} from './analysis-prompts'
import type { TopicAnalysisRepository, TopicObjectStore } from './ports'
import { renderAnalysisMarkdown } from './render-analysis-markdown'

interface ExecuteTopicAnalysisDependencies {
  repository: TopicAnalysisRepository
  objectStore: TopicObjectStore
  aiModel: AiModelClient
  model: string
  maxAttempts: number
  maxContextBytes: number
  now?: () => number
}

export async function executeTopicAnalysis(topicId: string, dependencies: ExecuteTopicAnalysisDependencies) {
  const topic = await dependencies.repository.getTopicEvidenceInput(topicId)
  if (!topic) throw new Error(`Topic bulunamadı: ${topicId}`)

  await dependencies.repository.markTopicAnalyzing(topicId)
  const evidence = await buildEvidenceBundle(topic, dependencies.objectStore, { maxContextBytes: dependencies.maxContextBytes })
  const topicRoot = `runs/${topic.targetDate.replaceAll('-', '/')}/${topic.runId}/topics/${topicId}`
  const manifestObjectKey = `${topicRoot}/evidence/manifest.json`
  await dependencies.objectStore.putRunFile(manifestObjectKey, evidence.manifest, 'application/json')
  await dependencies.repository.saveEvidenceBundle(topicId, { manifestObjectKey, sourceSignature: evidence.signature })

  const version = await dependencies.repository.nextAnalysisVersion(topicId)
  const revisionDirectory = `r${String(version).padStart(2, '0')}`
  const inputHash = createHash('sha256')
    .update(`${evidence.signature}\n${dependencies.model}\n${TOPIC_ANALYSIS_PROMPT_VERSION}`)
    .digest('hex')
  const now = dependencies.now ?? Date.now

  for (let attemptNo = 1; attemptNo <= dependencies.maxAttempts; attemptNo += 1) {
    const execution = await dependencies.repository.startTopicAiExecution({
      topicId,
      kind: 'INITIAL_ANALYSIS',
      attemptNo,
      model: dependencies.model,
      promptVersion: TOPIC_ANALYSIS_PROMPT_VERSION,
      schemaVersion: 1,
      inputHash,
    })
    const startedAt = now()
    try {
      const response = await dependencies.aiModel.generateStructured({
        model: dependencies.model,
        systemInstruction: buildTopicAnalysisSystemInstruction(),
        parts: evidence.aiParts,
        responseJsonSchema: analysisResponseJsonSchema,
      })
      const analysis = AnalysisResultSchema.parse(response.json)
      if (analysis.topicId !== topicId) throw new Error(`Model farklı bir topic döndürdü: ${analysis.topicId}`)

      const analysisObjectKey = `${topicRoot}/analysis/${revisionDirectory}/analysis.json`
      const markdownObjectKey = `${topicRoot}/analysis/${revisionDirectory}/analysis.md`
      await dependencies.objectStore.putRunFile(analysisObjectKey, Buffer.from(JSON.stringify(analysis)), 'application/json')
      await dependencies.objectStore.putRunFile(markdownObjectKey, Buffer.from(renderAnalysisMarkdown(analysis)), 'text/markdown; charset=utf-8')
      const revision = await dependencies.repository.createAnalysisRevision({
        topicId,
        version,
        status: analysis.status,
        analysisObjectKey,
        markdownObjectKey,
        model: dependencies.model,
        promptVersion: TOPIC_ANALYSIS_PROMPT_VERSION,
        schemaVersion: analysis.schemaVersion,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      })
      await dependencies.repository.completeTopicAiExecution(execution.id, {
        analysisRevisionId: revision.id,
        providerRequestId: response.providerRequestId,
        latencyMs: Math.max(0, now() - startedAt),
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
      })
      return { ...revision, analysisObjectKey, markdownObjectKey, analysis }
    } catch (error) {
      if (error instanceof ZodError) {
        const paths = error.issues.slice(0, 8).map((issue) => issue.path.join('.'))
        console.error('Topic analysis response validation failed', { topicId, paths, issueCount: error.issues.length })
        const failure: AiCallFailure = {
          category: 'INVALID_RESPONSE', providerStatus: null,
          message: 'Yapay zekâ analiz yanıtı doğrulanamadı. Analiz yeniden denenebilir.',
        }
        await dependencies.repository.failTopicAiExecution(execution.id, { ...failure, message: `${failure.message} Alanlar: ${paths.join(', ')}` })
        if (attemptNo < dependencies.maxAttempts) continue
        await dependencies.repository.markTopicAwaitingRetry(topicId, failure)
        throw new AiProviderError('INVALID_RESPONSE', true, failure.message)
      }
      if (error instanceof AiProviderError) {
        const failure = toFailure(error)
        await dependencies.repository.failTopicAiExecution(execution.id, failure)
        if (error.retryable && attemptNo < dependencies.maxAttempts) continue
        if (error.retryable) await dependencies.repository.markTopicAwaitingRetry(topicId, failure)
        else await dependencies.repository.markTopicBlocked(topicId, failure.message, failure.category)
        throw error
      }

      console.error('Topic analysis failed unexpectedly', { topicId, error })
      const message = 'Analiz işlenirken beklenmedik bir hata oluştu.'
      await dependencies.repository.failTopicAiExecution(execution.id, {
        category: 'UNKNOWN_PROVIDER_ERROR',
        providerStatus: null,
        message,
      })
      await dependencies.repository.markTopicBlocked(topicId, message, 'UNKNOWN_PROVIDER_ERROR')
      throw error
    }
  }

  throw new Error('Analiz denemeleri tamamlanamadı.')
}

function toFailure(error: AiProviderError): AiCallFailure {
  return { category: error.category, providerStatus: error.providerStatus, message: error.message }
}
