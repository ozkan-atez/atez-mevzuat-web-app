import { templateInstructions } from '../../workspace/template-sections'
import { ZodError } from 'zod'
import { enrichWithTariff } from './enrich-with-tariff'
import type { TariffLookup } from '../../tariff/tariff-lookup'
import { createHash } from 'node:crypto'
import type { AiModelClient } from '../../ai/application/ai-model-client'
import { AiProviderError } from '../../ai/domain/ai-errors'
import type { AiCallFailure } from '../../scan-runs/application/ports'
import { AnalysisResultSchema, type AnalysisResult } from '../domain/analysis-schemas'
import { buildEvidenceBundle } from './build-evidence-bundle'
import {
  analysisResponseJsonSchema,
  buildTopicAnalysisSystemInstruction,
  TOPIC_ANALYSIS_PROMPT_VERSION,
} from './analysis-prompts'
import type { TopicAnalysisRepository, TopicObjectStore, TopicEvidenceInput } from './ports'
import { renderAnalysisMarkdown } from './render-analysis-markdown'

interface ExecuteTopicAnalysisDependencies {
  repository: TopicAnalysisRepository
  objectStore: TopicObjectStore
  aiModel: AiModelClient
  model: string
  maxAttempts: number
  tariffLookup?: TariffLookup
  maxContextBytes: number
  now?: () => number
}

export async function executeTopicAnalysis(topicId: string, dependencies: ExecuteTopicAnalysisDependencies) {
  const topic = await dependencies.repository.getTopicEvidenceInput(topicId)
  if (!topic) throw new Error(`Topic bulunamadı: ${topicId}`)

  const templateContext=await dependencies.repository.getRunReportContext?.(topic.runId)
  const sectionInstructions=templateInstructions(templateContext?.workspaceConfig)
  await dependencies.repository.markTopicAnalyzing(topicId)
  const baseEvidence = await buildEvidenceBundle(topic, dependencies.objectStore, { maxContextBytes: dependencies.maxContextBytes })
  let evidence = baseEvidence
  if (dependencies.tariffLookup && (!topic.allowedSourceKeys || topic.allowedSourceKeys.includes('tariff'))) {
    try { evidence = await enrichWithTariff({topic,evidence:baseEvidence,objectStore:dependencies.objectStore,aiModel:dependencies.aiModel,model:dependencies.model,lookup:dependencies.tariffLookup}) }
    catch { evidence = baseEvidence }
  }
  const topicRoot = `runs/${topic.targetDate.replaceAll('-', '/')}/${topic.runId}/topics/${topicId}`
  const manifestObjectKey = `${topicRoot}/evidence/manifest.json`
  await dependencies.objectStore.putRunFile(manifestObjectKey, evidence.manifest, 'application/json')
  await dependencies.repository.saveEvidenceBundle(topicId, { manifestObjectKey, sourceSignature: evidence.signature })

  const version = await dependencies.repository.nextAnalysisVersion(topicId)
  const revisionDirectory = `r${String(version).padStart(2, '0')}`
  const inputHash = createHash('sha256')
    .update(`${evidence.signature}\n${dependencies.model}\n${TOPIC_ANALYSIS_PROMPT_VERSION}\n${sectionInstructions}`)
    .digest('hex')
  const now = dependencies.now ?? Date.now

  let validationFeedback: string | null = null

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
        systemInstruction: buildTopicAnalysisSystemInstruction()+sectionInstructions,
        parts: validationFeedback ? [...evidence.aiParts, { text: validationFeedback }] : evidence.aiParts,
        responseJsonSchema: analysisResponseJsonSchema,
      })
      const analysis = parseGeneratedAnalysis(response.json)
      assertPreviousSourceEvidence(analysis, topic)
      normalizeAnalysisSource(analysis,topic)
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
      if (error instanceof AiProviderError) {
        const failure = toFailure(error)
        await dependencies.repository.failTopicAiExecution(execution.id, failure)
        if (error.retryable && attemptNo < dependencies.maxAttempts) continue
        await dependencies.repository.markTopicAwaitingRetry(topicId, failure)
        throw error
      }

      if (error instanceof ZodError) {
        // Keep diagnostics in execution history, but expose an actionable message to users.
        await dependencies.repository.failTopicAiExecution(execution.id, {
          category: 'INVALID_RESPONSE', providerStatus: null, message: error.message,
        })
        validationFeedback = [
          'Önceki analiz JSON sözleşmesi doğrulamasından geçmedi. Kaynak kanıtlarını yeniden kullanarak tam ve düzeltilmiş bir JSON yanıtı üret.',
          'Aşağıdaki doğrulama tanıları yalnızca alan hatalarını belirtir; yeni bilgi veya kanıt değildir.',
          JSON.stringify(error.issues.map(({path, message}) => ({path, message}))),
        ].join('\n')
        if (attemptNo < dependencies.maxAttempts) continue
        const failure = new AiProviderError('INVALID_RESPONSE', true,
          'Analiz çıktısı içerik doğrulamasından geçmedi. Otomatik düzeltme denemeleri tamamlandı; analizi tekrar deneyebilirsiniz.')
        await dependencies.repository.markTopicAwaitingRetry(topicId, toFailure(failure))
        throw failure
      }

      const message = error instanceof Error ? error.message : 'Gemini geçersiz bir analiz yanıtı döndürdü.'
      await dependencies.repository.failTopicAiExecution(execution.id, {
        category: 'INVALID_RESPONSE',
        providerStatus: null,
        message,
      })
      await dependencies.repository.markTopicBlocked(topicId, message)
      throw error
    }
  }

  throw new Error('Analiz denemeleri tamamlanamadı.')
}

function toFailure(error: AiProviderError): AiCallFailure {
  return { category: error.category, providerStatus: error.providerStatus, message: error.message }
}

/** Source authority is assigned by persisted provenance, never by model output. */
export function normalizeAnalysisSource(analysis: AnalysisResult, topic: TopicEvidenceInput): void {
  if (!topic.sourceOrigin) { delete analysis.document.sourceOrigin; return }
  analysis.document.sourceOrigin = topic.sourceOrigin
  analysis.document.gazetteNumber = topic.sourceOrigin.name
  analysis.document.gazetteDate = topic.targetDate
  analysis.document.sourceUrl = topic.document.sourceUrl
  if (topic.sourceOrigin.authority !== 'OFFICIAL') {
    analysis.supportingSources = [...analysis.supportingSources,...analysis.officialSources].map(source => ({...source,label:source.url===topic.document.sourceUrl?topic.sourceOrigin!.name:source.label}))
    analysis.officialSources = []
  }
}

/** Provenance is application-owned; provider metadata is never trusted. */
export function parseGeneratedAnalysis(value: unknown): AnalysisResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return AnalysisResultSchema.parse(value)
  const normalized = { ...value } as Record<string, unknown>
  // Only the email subject is shortened. The source document title remains intact.
  if (typeof normalized.emailTitle === 'string') {
    const title = normalized.emailTitle.trim()
    if (title.length > 120) {
      const prefix = title.slice(0, 119).replace(/[\uD800-\uDBFF]$/, '')
      const boundary = prefix.lastIndexOf(' ')
      normalized.emailTitle = `${boundary >= 80 ? prefix.slice(0, boundary) : prefix}…`
    }
  }
  if (normalized.document && typeof normalized.document === 'object' && !Array.isArray(normalized.document)) {
    const document = { ...normalized.document } as Record<string, unknown>
    delete document.sourceOrigin
    normalized.document = document
  }
  return AnalysisResultSchema.parse(normalized)
}

/** A current amendment alone cannot establish the former rule or its absence. */
export function assertPreviousSourceEvidence(analysis: AnalysisResult, topic: TopicEvidenceInput): void {
  if (topic.previousSource) return
  const issues = []
  if (analysis.change.previousRule) issues.push({code:'custom' as const, path:['change','previousRule'], message:'Önceki kaynak paketi yok; önceki hüküm veya uygulamanın yokluğu varsayılamaz. previousRule alanını kaldır.'})
  if (analysis.comparisons.length) issues.push({code:'custom' as const, path:['comparisons'], message:'Önceki kaynak paketi yok; kanıtsız eski–yeni karşılaştırması üretme. comparisons boş dizi olmalıdır.'})
  if (issues.length) throw new ZodError(issues)
}
