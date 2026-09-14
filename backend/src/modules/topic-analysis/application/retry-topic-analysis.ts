import type { AiModelClient } from '../../ai/application/ai-model-client'
import type { PrismaScanRepository } from '../../scan-runs/infrastructure/prisma-scan-repository'
import { resumeRunAfterTopicRetry } from '../../scan-runs/application/execute-scan-run'
import type { ObjectStore } from '../../scan-runs/application/ports'
import { AnalysisResultSchema } from '../domain/analysis-schemas'
import type { PrismaTopicAnalysisRepository } from '../infrastructure/prisma-topic-analysis-repository'
import { executeTopicAnalysis } from './execute-topic-analysis'
import { publishTopicAnalysis, type TopicAnalysisOutput } from './execute-run-topic-analyses'
import type { TopicAnalysisRepository, TopicObjectStore } from './ports'

interface Dependencies {
  repository: PrismaTopicAnalysisRepository
  scanRepository: PrismaScanRepository
  objectStore: ObjectStore
  aiModel: AiModelClient
  model: string
  maxAttempts: number
  maxContextBytes: number
}

export async function retryTopicAnalysis(topicId: string, dependencies: Dependencies): Promise<void> {
  const existing = await dependencies.repository.getTopicDetail(topicId)
  if (!existing) throw new Error(`Topic bulunamadı: ${topicId}`)

  if (existing.status !== 'COMPLETED') {
    const output = await recoverAnalysisForRetry(existing, dependencies)
    if (output.analysis.status === 'PASS') {
      const context = await dependencies.repository.getRunReportContext(existing.runId)
      if (!context) throw new Error('Run rapor bağlamı bulunamadı.')
      await publishTopicAnalysis(context, output, await dependencies.repository.getTopicSequence(topicId), dependencies)
    } else {
      await dependencies.repository.markTopicCompleted(topicId)
    }
  }

  await resumeRunAfterTopicRetry(existing.runId, {
    repository: dependencies.scanRepository,
    topicRepository: dependencies.repository,
    objectStore: dependencies.objectStore,
  })
}

export async function recoverAnalysisForRetry(
  existing: {
    id: string
    status: string
    latestAnalysis: null | { id: string; version: number; analysisObjectKey: string; markdownObjectKey: string }
  },
  dependencies: {
    repository: TopicAnalysisRepository
    objectStore: TopicObjectStore
    aiModel: AiModelClient
    model: string
    maxAttempts: number
    maxContextBytes: number
  },
): Promise<TopicAnalysisOutput> {
  if (existing.latestAnalysis && ['ANALYZED', 'RENDERING', 'VALIDATING'].includes(existing.status)) {
    const analysis = AnalysisResultSchema.parse(JSON.parse(
      (await dependencies.objectStore.getContent(existing.latestAnalysis.analysisObjectKey)).toString('utf8'),
    ))
    return {
      id: existing.latestAnalysis.id,
      version: existing.latestAnalysis.version,
      analysisObjectKey: existing.latestAnalysis.analysisObjectKey,
      markdownObjectKey: existing.latestAnalysis.markdownObjectKey,
      analysis,
    }
  }
  return executeTopicAnalysis(existing.id, dependencies)
}
