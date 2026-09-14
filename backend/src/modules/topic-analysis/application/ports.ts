import type { AiInputPart } from '../../ai/application/ai-model-client'
import type { AiCallFailure } from '../../scan-runs/application/ports'

export interface TopicStoredObject {
  objectKey: string
  sha256: string
  mediaType: string
  byteSize: bigint
}

export interface TopicEvidenceAsset {
  id: string
  sourceUrl: string
  role: 'ATTACHMENT' | 'IMAGE' | 'STYLESHEET_ASSET' | 'OTHER_SUPPORTED'
  object: TopicStoredObject
}

export interface TopicEvidenceInput {
  topicId: string
  runId: string
  targetDate: string
  document: {
    title: string
    sourceUrl: string
    object: TopicStoredObject
    assets: TopicEvidenceAsset[]
  }
  previousSource: null | {
    title: string
    sourceUrl: string
    object: TopicStoredObject
    assets: TopicEvidenceAsset[]
  }
}

export interface TopicObjectStore {
  getContent(key: string): Promise<Buffer>
  putRunFile(key: string, body: Buffer, mediaType: string): Promise<{
    objectKey: string
    sha256: string
    mediaType: string
    byteSize: bigint
  }>
}

export interface EvidencePart {
  topicId: string
  sourceId: string
  title: string
  sourceUrl: string
  objectKey: string
  sha256: string
  mediaType: string
  byteSize: string
}

export interface EvidenceContext {
  topicId: string
  signature: string
  parts: EvidencePart[]
  aiParts: AiInputPart[]
  manifest: Buffer
}

export interface CreateTopicAnalysisRevisionInput {
  topicId: string
  version: number
  status: 'PASS' | 'PASS_NO_RELEVANT_CONTENT'
  analysisObjectKey: string
  markdownObjectKey: string
  model: string
  promptVersion: string
  schemaVersion: number
  inputTokens: number | null
  outputTokens: number | null
  requestMessageId?: string
}

export interface TopicAnalysisRepository {
  getTopicEvidenceInput(topicId: string): Promise<TopicEvidenceInput | null>
  markTopicAnalyzing(topicId: string): Promise<void>
  saveEvidenceBundle(topicId: string, input: { manifestObjectKey: string; sourceSignature: string }): Promise<void>
  nextAnalysisVersion(topicId: string): Promise<number>
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
  failTopicAiExecution(id: string, error: AiCallFailure): Promise<void>
  createAnalysisRevision(input: CreateTopicAnalysisRevisionInput): Promise<{ id: string; version: number }>
  markTopicAwaitingRetry(topicId: string, error: AiCallFailure): Promise<void>
  markTopicBlocked(topicId: string, message: string): Promise<void>
}

export interface RunReportContext {
  runId: string
  targetDate: string
  indexSourceUrl: string
  indexObjectKey: string
  inspectedDocumentCount: number
}

export interface CreateTopicReportRevisionInput {
  scanRunId: string
  topicId: string | null
  analysisRevisionId: string | null
  title: string
  basename: string
  card: 'K1' | 'K2' | 'K3' | 'K4' | 'K5' | 'K6'
  version: number
  specObjectKey: string
  htmlObjectKey: string
  requestMessageId?: string
}

export interface StoredTopicReport {
  id: string
  revisionId: string
  topicId: string | null
  version: number
  basename: string
  card: CreateTopicReportRevisionInput['card']
  specObjectKey: string
  htmlObjectKey: string
}

export interface RunTopicAnalysisRepository extends TopicAnalysisRepository {
  ensureTopics(runId: string): Promise<Array<{ id: string; documentId: string; status: string }>>
  getRunReportContext(runId: string): Promise<RunReportContext | null>
  nextReportVersion(runId: string, topicId: string | null): Promise<number>
  createReportRevision(input: CreateTopicReportRevisionInput): Promise<StoredTopicReport>
  markTopicRendering(topicId: string): Promise<void>
  markTopicValidating(topicId: string): Promise<void>
  markTopicCompleted(topicId: string): Promise<void>
}
