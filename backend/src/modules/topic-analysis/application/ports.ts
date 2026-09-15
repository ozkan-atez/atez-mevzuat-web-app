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
  /** Set when the revision came from a published draft, linking it to its edits. */
  draftId?: string
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

export interface ReportDraftEditRecord {
  id: string
  sequence: number
  path: string
  previousValue: unknown
  nextValue: unknown
  source: 'USER' | 'AI'
  prompt: string | null
  chatMessageId: string | null
  revertsEditId: string | null
  revertedByEditId: string | null
  createdAt: string
}

export interface ReportDraftRecord {
  id: string
  topicId: string
  baseVersion: number
  spec: unknown
  status: 'OPEN' | 'PUBLISHED' | 'DISCARDED'
  edits: ReportDraftEditRecord[]
  createdAt: string
  updatedAt: string
}

export interface PublishedReportBase {
  runId: string
  targetDate: string
  version: number
  analysisRevisionId: string | null
  basename: string
  /** The use-case loads the spec itself; only the object store can read it. */
  specObjectKey: string
}

/**
 * Persistence boundary for revision drafts. The use-cases depend on this, not on
 * Prisma, so the patch and publish logic stays testable without a database.
 */
export interface ReportDraftRepository {
  /** The latest validated revision a draft can be based on. */
  getPublishedBase(topicId: string): Promise<PublishedReportBase | null>
  getOpenDraft(topicId: string): Promise<ReportDraftRecord | null>
  openDraft(input: { topicId: string; baseVersion: number; spec: unknown; createdBy: string | null }): Promise<ReportDraftRecord>
  appendEdits(input: {
    draftId: string
    spec: unknown
    requestKey: string | null
    source: 'USER' | 'AI'
    prompt: string | null
    chatMessageId: string | null
    edits: Array<{ path: string; previousValue: unknown; nextValue: unknown; revertsEditId: string | null }>
  }): Promise<ReportDraftRecord>
  /** Returns the draft unchanged when the same request key was already applied. */
  findDraftByRequestKey(requestKey: string): Promise<ReportDraftRecord | null>
  closeDraft(draftId: string, status: 'PUBLISHED' | 'DISCARDED'): Promise<void>
}
