import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AiModelClient } from '../../ai/application/ai-model-client'
import { AiProviderError } from '../../ai/domain/ai-errors'
import { toGeminiJsonSchema } from '../../ai/application/gemini-json-schema'
import { AnalysisResultSchema } from '../domain/analysis-schemas'
import { ReportSpecSchema, type ReportSpec } from '../domain/report-spec-schemas'
import type { PrismaTopicAnalysisRepository } from '../infrastructure/prisma-topic-analysis-repository'
import { buildEvidenceBundle } from './build-evidence-bundle'
import { buildRevisionContext } from './build-revision-context'
import { analysisResponseJsonSchema, buildTopicAnalysisSystemInstruction, TOPIC_ANALYSIS_PROMPT_VERSION } from './analysis-prompts'
import { publishTopicAnalysis } from './execute-run-topic-analyses'
import type { TopicObjectStore } from './ports'
import { renderAnalysisMarkdown } from './render-analysis-markdown'
import { renderReportHtml } from './render-report-html'
import { validateReportHtml } from './validate-report-html'

interface Dependencies {
  repository: PrismaTopicAnalysisRepository
  objectStore: TopicObjectStore
  aiModel: AiModelClient
  model: string
  maxContextBytes: number
}

export async function executeTopicRevision(command: { topicId: string; messageId: string }, dependencies: Dependencies): Promise<void> {
  const work = await dependencies.repository.getTopicRevisionWorkItem(command.topicId, command.messageId)
  if (!work) throw new Error('Topic revizyon bağlamı bulunamadı.')
  if (work.requestReport) {
    await appendSuccessResult(work, work.requestReport.version, dependencies)
    return
  }
  if (work.message.revisionKind === 'ANALYSIS' && work.requestAnalysis) {
    const analysis = AnalysisResultSchema.parse(JSON.parse((await dependencies.objectStore.getContent(work.requestAnalysis.analysisObjectKey)).toString('utf8')))
    if (analysis.status === 'PASS') {
      const context = await dependencies.repository.getRunReportContext(work.runId)
      if (!context) throw new Error('Run rapor bağlamı bulunamadı.')
      await publishTopicAnalysis(context, {
        ...work.requestAnalysis,
        analysis,
        requestMessageId: work.message.id,
      }, await dependencies.repository.getTopicSequence(work.topicId), dependencies)
    } else {
      await dependencies.repository.markTopicCompleted(work.topicId)
    }
    await appendSuccessResult(work, work.requestAnalysis.version, dependencies)
    return
  }
  if (work.message.revisionKind === 'PUBLICATION') await executePublicationRevision(work, dependencies)
  else await executeAnalysisRevision(work, dependencies)
}

async function executeAnalysisRevision(work: NonNullable<Awaited<ReturnType<PrismaTopicAnalysisRepository['getTopicRevisionWorkItem']>>>, dependencies: Dependencies) {
  const topic = await dependencies.repository.getTopicEvidenceInput(work.topicId)
  if (!topic) throw new Error('Topic kanıt paketi bulunamadı.')
  const evidence = await buildEvidenceBundle(topic, dependencies.objectStore, { maxContextBytes: dependencies.maxContextBytes })
  const currentJson = (await dependencies.objectStore.getContent(work.latestAnalysis.analysisObjectKey)).toString('utf8')
  const currentMarkdown = (await dependencies.objectStore.getContent(work.latestAnalysis.markdownObjectKey)).toString('utf8')
  const parts = [
    ...evidence.aiParts,
    ...buildRevisionContext({ currentAnalysisJson: currentJson, currentAnalysisMarkdown: currentMarkdown, request: work.message.content, recentMessages: work.recentMessages }),
  ]
  const execution = await dependencies.repository.startTopicAiExecution({
    topicId: work.topicId, kind: 'ANALYSIS_REVISION', attemptNo: 1, model: dependencies.model,
    promptVersion: `${TOPIC_ANALYSIS_PROMPT_VERSION}-revision`, schemaVersion: 1,
    inputHash: hashInput(evidence.signature, work.message.content, dependencies.model),
    requestMessageId: work.message.id,
  })
  const startedAt = Date.now()
  try {
    const response = await dependencies.aiModel.generateStructured({
      model: dependencies.model,
      systemInstruction: `${buildTopicAnalysisSystemInstruction()}\nBu bir revizyondur. Kullanıcının talebini yalnızca kanıtlar destekliyorsa uygula; topic kimliğini değiştirme.`,
      parts,
      responseJsonSchema: analysisResponseJsonSchema,
    })
    const analysis = AnalysisResultSchema.parse(response.json)
    if (analysis.topicId !== work.topicId) throw new Error('Revizyon farklı topic kimliği döndürdü.')
    const version = await dependencies.repository.nextAnalysisVersion(work.topicId)
    const root = `runs/${topic.targetDate.replaceAll('-', '/')}/${topic.runId}/topics/${work.topicId}/analysis/r${String(version).padStart(2, '0')}`
    const analysisObjectKey = `${root}/analysis.json`
    const markdownObjectKey = `${root}/analysis.md`
    await dependencies.objectStore.putRunFile(analysisObjectKey, Buffer.from(JSON.stringify(analysis)), 'application/json')
    await dependencies.objectStore.putRunFile(markdownObjectKey, Buffer.from(renderAnalysisMarkdown(analysis)), 'text/markdown; charset=utf-8')
    const revision = await dependencies.repository.createAnalysisRevision({
      topicId: work.topicId, version, status: analysis.status, analysisObjectKey, markdownObjectKey,
      model: dependencies.model, promptVersion: `${TOPIC_ANALYSIS_PROMPT_VERSION}-revision`, schemaVersion: 1,
      inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens,
      requestMessageId: work.message.id,
    })
    await dependencies.repository.completeTopicAiExecution(execution.id, {
      analysisRevisionId: revision.id, providerRequestId: response.providerRequestId, latencyMs: Date.now() - startedAt,
      inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens,
    })
    if (analysis.status === 'PASS') {
      const context = await dependencies.repository.getRunReportContext(topic.runId)
      if (!context) throw new Error('Run rapor bağlamı bulunamadı.')
      await publishTopicAnalysis(context, { ...revision, analysisObjectKey, markdownObjectKey, analysis, requestMessageId: work.message.id }, await dependencies.repository.getTopicSequence(work.topicId), dependencies)
    } else {
      await dependencies.repository.markTopicCompleted(work.topicId)
    }
    await appendSuccessResult(work, version, dependencies)
  } catch (error) {
    await failRevision(work.topicId, execution.id, 'ANALYSIS', error, dependencies)
    throw error
  }
}

async function executePublicationRevision(work: NonNullable<Awaited<ReturnType<PrismaTopicAnalysisRepository['getTopicRevisionWorkItem']>>>, dependencies: Dependencies) {
  if (!work.latestReport) throw new Error('Revize edilecek yayın bulunamadı.')
  const currentSpec = ReportSpecSchema.parse(JSON.parse((await dependencies.objectStore.getContent(work.latestReport.specObjectKey)).toString('utf8')))
  const currentAnalysisJson = (await dependencies.objectStore.getContent(work.latestAnalysis.analysisObjectKey)).toString('utf8')
  const execution = await dependencies.repository.startTopicAiExecution({
    topicId: work.topicId, kind: 'PUBLICATION_REVISION', attemptNo: 1, model: dependencies.model,
    promptVersion: 'topic-publication-revision-v1', schemaVersion: 1,
    inputHash: hashInput(JSON.stringify(currentSpec), work.message.content, dependencies.model),
    requestMessageId: work.message.id,
  })
  const startedAt = Date.now()
  try {
    const response = await dependencies.aiModel.generateStructured({
      model: dependencies.model,
      systemInstruction: 'Mevcut ATEZ rapor spesifikasyonunun yalnızca ifade biçimini kullanıcı talebine göre revize et. Kanonik analizde olmayan olgu ekleme. topicId, card, reportId, issueNumber ve kaynak URL alanlarını değiştirme. Yalnızca JSON Schema ile uyumlu JSON döndür.',
      parts: [{ text: `Kanonik analiz:\n${currentAnalysisJson}` }, { text: `Mevcut rapor spesifikasyonu:\n${JSON.stringify(currentSpec)}` }, { text: `Revizyon talebi:\n${work.message.content}` }],
      responseJsonSchema: toGeminiJsonSchema(z.toJSONSchema(ReportSpecSchema, { target: 'draft-7' }) as Record<string, unknown>),
    })
    const revised = ReportSpecSchema.parse(response.json)
    assertPublicationIdentity(currentSpec, revised)
    const context = await dependencies.repository.getRunReportContext(work.runId)
    if (!context) throw new Error('Run rapor bağlamı bulunamadı.')
    const version = await dependencies.repository.nextReportVersion(work.runId, work.topicId)
    const root = `runs/${context.targetDate.replaceAll('-', '/')}/${work.runId}/topics/${work.topicId}/reports/r${String(version).padStart(2, '0')}`
    const specObjectKey = `${root}/report-spec.json`
    const htmlObjectKey = `${root}/report.html`
    const html = await renderReportHtml(revised)
    validateReportHtml(html, { card: revised.card, topicId: work.topicId, basename: work.latestReport.basename })
    await dependencies.objectStore.putRunFile(specObjectKey, Buffer.from(JSON.stringify(revised)), 'application/json')
    await dependencies.objectStore.putRunFile(htmlObjectKey, Buffer.from(html), 'text/html; charset=utf-8')
    const report = await dependencies.repository.createReportRevision({
      scanRunId: work.runId, topicId: work.topicId, analysisRevisionId: work.latestAnalysis.id,
      title: revised.documentTitle, basename: work.latestReport.basename, card: revised.card, version, specObjectKey, htmlObjectKey,
      requestMessageId: work.message.id,
    })
    await dependencies.repository.completeTopicAiExecution(execution.id, {
      analysisRevisionId: work.latestAnalysis.id, providerRequestId: response.providerRequestId, latencyMs: Date.now() - startedAt,
      inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens,
    })
    await appendSuccessResult(work, report.version, dependencies)
  } catch (error) {
    await failRevision(work.topicId, execution.id, 'PUBLICATION', error, dependencies)
    throw error
  }
}

async function appendSuccessResult(
  work: NonNullable<Awaited<ReturnType<PrismaTopicAnalysisRepository['getTopicRevisionWorkItem']>>>,
  version: number,
  dependencies: Dependencies,
): Promise<void> {
  const publication = work.message.revisionKind === 'PUBLICATION'
  await dependencies.repository.appendRevisionResult(work.topicId, {
    role: 'ASSISTANT', kind: 'REVISION_RESULT', revisionKind: work.message.revisionKind,
    content: `${publication ? 'Rapor' : 'Analiz'} revizyonu r${String(version).padStart(2, '0')} oluşturuldu.`,
    requestKey: `revision-result:${work.message.id}`,
  })
}

async function failRevision(topicId: string, executionId: string, revisionKind: 'ANALYSIS' | 'PUBLICATION', error: unknown, dependencies: Dependencies) {
  const failure = error instanceof AiProviderError
    ? { category: error.category, providerStatus: error.providerStatus, message: error.message }
    : { category: 'INVALID_RESPONSE' as const, providerStatus: null, message: error instanceof Error ? error.message : 'Revizyon başarısız.' }
  await dependencies.repository.failTopicAiExecution(executionId, failure)
  if (error instanceof AiProviderError && error.retryable) await dependencies.repository.markTopicAwaitingRetry(topicId, failure)
  else await dependencies.repository.markTopicBlocked(topicId, failure.message)
  await dependencies.repository.appendRevisionResult(topicId, { role: 'ASSISTANT', kind: 'ERROR', revisionKind, content: failure.message })
}

function assertPublicationIdentity(current: ReportSpec, revised: ReportSpec): void {
  if (current.card !== revised.card || current.topicId !== revised.topicId || current.reportId !== revised.reportId || current.issueNumber !== revised.issueNumber || current.source.url !== revised.source.url) {
    throw new Error('Yayın revizyonu değiştirilemez kimlik veya kaynak alanını değiştirdi.')
  }
}

function hashInput(...values: string[]): string { return createHash('sha256').update(values.join('\n')).digest('hex') }
