import type { ScanRunStatus, ScanStage } from '../domain/scan-run'

export type AssetRole = 'ATTACHMENT' | 'IMAGE' | 'STYLESHEET_ASSET' | 'OTHER_SUPPORTED'
export type ValidationStatus = 'PENDING' | 'VALID' | 'INVALID'

export interface StoredBlob {
  sha256: string
  bucket: string
  objectKey: string
  mediaType: string
  byteSize: bigint
  versionId?: string
}

export interface DownloadedFile {
  tempPath: string
  sha256: string
  mediaType: string
  byteSize: bigint
  sourceUrl: string
}

export interface DiscoveredAsset {
  sourceUrl: string
  role: AssetRole
  referenceText?: string
}

export interface DiscoveredDocument {
  title: string
  documentType?: string
  sourceUrl: string
  publicationOrder: number
}

export interface DiscoveredEdition {
  type: 'MAIN' | 'SUPPLEMENT'
  supplementNo: number | null
  indexUrl: string
  discoveryOrder: number
  documents: DiscoveredDocument[]
}

export interface FetchAttemptInput {
  runId: string
  sourceUrl: string
  attemptNo: number
  status: 'SUCCESS' | 'FAILED'
  httpStatus?: number
  redirectUrl?: string
  byteSize?: bigint
  errorClass?: string
  errorMessage?: string
}

export interface ScanRunDetailDto {
  id: string
  status: ScanRunStatus
  currentStage: ScanStage | null
  targetDate: string
  startedAt: string | null
  completedAt: string | null
  errorSummary: string | null
  filter: null | {
    status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'AWAITING_RETRY' | 'FAILED'
    counts: { in: number; out: number; pending: number }
    retryAvailable: boolean
    errorCategory: AiCallFailure['category'] | null
    errorMessage: string | null
  }
  previousSources: null | {
    status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'AWAITING_RETRY' | 'FAILED'
    counts: { total: number; completed: number; verified: number; notRequired: number; notFound: number; ambiguous: number; pending: number }
    retryAvailable: boolean
    errorMessage: string | null
  }
  analysis: null | {
    counts: { total: number; completed: number; awaitingRetry: number; failed: number }
    topics: Array<{
      id: string
      documentId: string
      title: string
      status: 'QUEUED' | 'ANALYZING' | 'ANALYZED' | 'RENDERING' | 'VALIDATING' | 'COMPLETED' | 'AWAITING_RETRY' | 'BLOCKED' | 'FAILED'
      retryAvailable: boolean
      errorCategory: AiCallFailure['category'] | null
      errorMessage: string | null
      analysisVersion: number | null
      reportVersion: number | null
      reportCard: 'K1' | 'K2' | 'K3' | 'K4' | 'K5' | 'K6' | null
      reportBasename: string | null
    }>
  }
  reports: Array<{
    id: string
    topicId: string | null
    title: string
    basename: string
    card: 'K1' | 'K2' | 'K3' | 'K4' | 'K5' | 'K6'
    version: number
    htmlObjectKey: string
  }>
  counts: {
    editions: number
    documents: number
    assets: number
    completedItems: number
    totalItems: number
    failedItems: number
  }
  stages: Array<{
    stage: ScanStage
    status: 'PENDING' | 'RUNNING' | 'AWAITING_RETRY' | 'COMPLETED' | 'FAILED'
    completedItems: number
    totalItems: number
    failedItems: number
  }>
  editions: Array<{
    id: string
    type: 'MAIN' | 'SUPPLEMENT'
    supplementNo: number | null
    documents: Array<{
      id: string
      title: string
      sourceUrl: string
      validationStatus: ValidationStatus
      assetCount: number
      filter: null | {
        titleDecision: 'IN' | 'OUT' | 'MAYBE'
        finalDecision: 'IN' | 'OUT' | null
        reason: string
      }
      previousSource: null | {
        status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'AWAITING_RETRY' | 'FAILED'
        outcome: 'NOT_REQUIRED' | 'VERIFIED' | 'NOT_FOUND' | 'AMBIGUOUS' | null
        needsPreviousSource: boolean | null
        reason: string | null
        title: string | null
        publicationDate: string | null
        gazetteNo: string | null
        sourceUrl: string | null
      }
    }>
  }>
}

export interface ScanRunSummaryDto {
  id: string
  trigger: 'MANUAL' | 'CRON'
  status: ScanRunStatus
  currentStage: ScanStage | null
  targetDate: string
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  counts: { editions: number; documents: number; assets: number }
}

export interface FilterConfiguration {
  model: string
  titlePromptVersion: string
  contentPromptVersion: string
  configurationHash: string
}

export interface AiJobRecord {
  id: string
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'AWAITING_RETRY' | 'FAILED'
  configuration: FilterConfiguration
}

export interface FilterDocumentRecord {
  id: string
  title: string
  sourceUrl: string
  publicationOrder: number
  editionLabel: string
  storedObject: null | {
    objectKey: string
    sha256: string
    mediaType: string
    byteSize: bigint
  }
}

export interface TitleDecision {
  documentId: string
  decision: 'IN' | 'OUT' | 'MAYBE'
  reason: string
  confidence: number
}

export interface ContentDecision {
  documentId: string
  decision: 'IN' | 'OUT'
  reason: string
  confidence: number
}

export interface StartAiCallInput {
  aiJobId: string
  phase: 'TITLE' | 'CONTENT'
  batchKey: string
  attemptNo: number
  inputHash: string
}

export interface AiCallRecord { id: string }

export interface AiCallCompletion {
  providerRequestId: string | null
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number
}

export interface FilterProgress {
  titlePassComplete: boolean
  unresolvedDocumentIds: string[]
  completedContentBatchKeys: string[]
  finalCounts: { in: number; out: number; pending: number }
}

export interface AiCallFailure {
  category: 'AUTHENTICATION' | 'PERMISSION' | 'QUOTA_EXCEEDED' | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'TIMEOUT' | 'INVALID_RESPONSE' | 'CONTENT_REJECTED' | 'UNKNOWN_PROVIDER_ERROR'
  providerStatus: number | null
  message: string
}

export interface PreviousSourceConfiguration {
  model: string
  promptVersion: string
  configurationHash: string
}

export interface PreviousSourceJobRecord {
  id: string
  documentId: string
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'AWAITING_RETRY' | 'FAILED'
}

export interface PreviousSourceWorkItem extends PreviousSourceJobRecord {
  intent: PreviousSourceIntentRecord | null
  document: {
    title: string
    sourceUrl: string
    documentType: string | null
    publicationDate: string
    storedObject: {
      objectKey: string
      sha256: string
      mediaType: string
      byteSize: bigint
    }
  }
}

export interface PreviousSourceCallInput {
  jobId: string
  attemptNo: number
  inputHash: string
}

export interface PreviousSourceIntentRecord {
  needsPreviousSource: boolean
  relationship: 'AMENDS' | 'REPEALS' | 'EXTENDS' | 'IMPLEMENTS' | 'NONE'
  targetRegulationTitle: string | null
  targetRegulationIdentifier: string | null
  targetRegulationType: string | null
  targetInstitution: string | null
  targetArticleReferences: string[]
  queryCandidates: string[]
  reason: string
}

export interface PreviousSourceCandidateRecord extends PreviousSourceSearchCandidate {
  documentUrl?: string | null
  exactIdentifierMatch: boolean
  titleScore: number
  score: number
  reasons: string[]
  selected: boolean
}

export interface PreviousSourceAssetInput {
  sourceUrl: string
  referenceText?: string
  role: AssetRole
  object: StoredBlob
}

export interface PreviousSourceSearchCandidate {
  query: string
  title: string
  publicationDate: string
  gazetteNo: string | null
  mukerrer: string | null
  url: string
  regulationType: string | null
}

export interface PreviousSourceSearch {
  search(input: { query: string; endDate: string; limit: number }): Promise<PreviousSourceSearchCandidate[]>
  resolveDocumentUrl(
    candidate: PreviousSourceSearchCandidate,
    intent: { targetRegulationIdentifier: string | null; targetRegulationTitle: string | null },
  ): Promise<string>
}

export interface CompletedRunSnapshot {
  run: ScanRunDetailDto
  index: { sourceUrl: string; objectKey: string; sha256: string }
  objects: Array<{
    documentId?: string
    assetId?: string
    parentDocumentId?: string
    sourceUrl: string
    role?: AssetRole
    objectKey: string
    sha256: string
    mediaType: string
    byteSize: bigint
  }>
  filterAudit: null | {
    model: string
    titlePromptVersion: string
    contentPromptVersion: string
    configurationHash: string
    decisions: Array<{
      documentId: string
      titleDecision: 'IN' | 'OUT' | 'MAYBE'
      titleReason: string
      titleConfidence: number
      contentDecision: 'IN' | 'OUT' | null
      contentReason: string | null
      contentConfidence: number | null
      finalDecision: 'IN' | 'OUT' | null
    }>
  }
  previousSourceAudit: Array<{
    documentId: string
    status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'AWAITING_RETRY' | 'FAILED'
    outcome: 'NOT_REQUIRED' | 'VERIFIED' | 'NOT_FOUND' | 'AMBIGUOUS' | null
    model: string
    promptVersion: string
    configurationHash: string
    intent: PreviousSourceIntentRecord | null
    calls: Array<{
      attemptNo: number
      status: 'RUNNING' | 'COMPLETED' | 'FAILED'
      inputHash: string
      providerRequestId: string | null
      inputTokens: number | null
      outputTokens: number | null
      latencyMs: number | null
      errorCategory: AiCallFailure['category'] | null
      providerStatus: number | null
      errorMessage: string | null
    }>
    candidates: PreviousSourceCandidateRecord[]
    source: null | {
      title: string
      publicationDate: string
      gazetteNo: string | null
      mukerrer: string | null
      sourceUrl: string
      objectKey: string
      sha256: string
      mediaType: string
      byteSize: bigint
      assets: Array<{
        sourceUrl: string
        referenceText: string | null
        role: AssetRole
        objectKey: string
        sha256: string
        mediaType: string
        byteSize: bigint
      }>
    }
  }>
  topicAnalysisAudit?: {
    topics: Array<{
      topicId: string
      documentId: string
      status: string
      evidenceManifestObjectKey: string | null
      sourceSignature: string | null
      analyses: Array<{
        id: string
        version: number
        status: string
        analysisObjectKey: string
        markdownObjectKey: string
        model: string
        promptVersion: string
        schemaVersion: number
        inputTokens: number | null
        outputTokens: number | null
      }>
      executions: Array<{
        kind: string
        attemptNo: number
        status: string
        model: string
        promptVersion: string
        schemaVersion: number
        inputHash: string
        providerRequestId: string | null
        inputTokens: number | null
        outputTokens: number | null
        latencyMs: number | null
        errorCategory: string | null
        providerStatus: number | null
        errorMessage: string | null
      }>
      reports: Array<{
        id: string
        basename: string
        card: string
        revisions: Array<{ version: number; status: string; card: string; analysisRevisionId: string | null; specObjectKey: string; htmlObjectKey: string }>
      }>
    }>
    noChangeReports: Array<{
      id: string
      basename: string
      card: string
      revisions: Array<{ version: number; status: string; card: string; specObjectKey: string; htmlObjectKey: string }>
    }>
  }
}

export interface ObjectStore {
  ensureBucket(): Promise<void>
  putContent(file: DownloadedFile): Promise<StoredBlob>
  putRunFile(key: string, body: Buffer, mediaType: string): Promise<StoredBlob>
  exists(key: string): Promise<boolean>
  getContent(key: string): Promise<Buffer>
}

export interface OfficialHttp {
  download(url: string, tempDirectory: string): Promise<DownloadedFile>
}

export interface ScanQueue {
  enqueue(command: ScanCommand): Promise<string>
}

export interface ScanCommand {
  outboxId: string
  runId: string
  type: 'START_SCAN' | 'RETRY_AI_FILTER' | 'RETRY_PREVIOUS_SOURCES'
}

export interface ScanRepository {
  createManualRun(input: { requestKey: string; targetDate: string }): Promise<{ id: string; status: ScanRunStatus; targetDate: string }>
  getRun(runId: string): Promise<ScanRunDetailDto | null>
  getExecutionRun(runId: string): Promise<{ id: string; status: ScanRunStatus; targetDate: string; downloadedBytes: bigint; indexObjectKey: string | null; indexSourceUrl: string | null } | null>
  saveIndex(runId: string, sourceUrl: string, object: StoredBlob): Promise<void>
  saveEditions(runId: string, targetDate: string, editions: DiscoveredEdition[]): Promise<void>
  listDocuments(runId: string): Promise<Array<{ id: string; sourceUrl: string; title: string }>>
  saveAssets(documentId: string, assets: DiscoveredAsset[]): Promise<void>
  listAssets(runId: string): Promise<Array<{ id: string; documentId: string; sourceUrl: string; storedObject: null | { objectKey: string; mediaType: string } }>>
  attachDocumentObject(documentId: string, object: StoredBlob): Promise<void>
  attachAssetObject(assetId: string, object: StoredBlob): Promise<void>
  completedSnapshot(runId: string): Promise<CompletedRunSnapshot>
  verifyManifestCounts(runId: string): Promise<void>
  completeRun(runId: string, manifestObjectKey: string): Promise<void>
  startRun(runId: string): Promise<void>
  startStage(runId: string, stage: ScanStage, totalItems: number): Promise<void>
  advanceStage(runId: string, stage: ScanStage, downloadedBytes: bigint): Promise<void>
  completeStage(runId: string, stage: ScanStage): Promise<void>
  failStage(runId: string, stage: ScanStage, error: string): Promise<void>
  failRun(runId: string, status: 'PARTIAL' | 'FAILED', error: string): Promise<void>
  getOrCreateDocumentFilterJob(runId: string, configuration: FilterConfiguration): Promise<AiJobRecord>
  listFilterDocuments(runId: string): Promise<FilterDocumentRecord[]>
  startAiCall(input: StartAiCallInput): Promise<AiCallRecord>
  completeAiCall(callId: string, result: AiCallCompletion): Promise<void>
  failAiCall(callId: string, error: AiCallFailure): Promise<void>
  saveTitleDecisions(jobId: string, decisions: TitleDecision[]): Promise<void>
  saveContentDecisions(jobId: string, batchKey: string, decisions: ContentDecision[]): Promise<void>
  getFilterProgress(jobId: string): Promise<FilterProgress>
  markFilterRunning(runId: string, jobId: string, totalItems: number): Promise<void>
  markFilterAwaitingRetry(runId: string, jobId: string, error: AiCallFailure): Promise<void>
  completeFilter(runId: string, jobId: string): Promise<void>
  nextAiCallAttempt(aiJobId: string, phase: 'TITLE' | 'CONTENT', batchKey: string): Promise<number>
  addDownloadedBytes(runId: string, byteSize: bigint): Promise<void>
  requestAiFilterRetry(runId: string, requestKey: string): Promise<{ runId: string; commandId: string; status: 'QUEUED' }>
  ensurePreviousSourceJobs(runId: string, configuration: PreviousSourceConfiguration): Promise<PreviousSourceJobRecord[]>
  listPreviousSourceWork(runId: string): Promise<PreviousSourceWorkItem[]>
  markPreviousSourceJobRunning(jobId: string): Promise<void>
  nextPreviousSourceCallAttempt(jobId: string): Promise<number>
  startPreviousSourceCall(input: PreviousSourceCallInput): Promise<AiCallRecord>
  completePreviousSourceCall(callId: string, result: AiCallCompletion): Promise<void>
  failPreviousSourceCall(callId: string, error: AiCallFailure): Promise<void>
  savePreviousSourceIntent(jobId: string, intent: PreviousSourceIntentRecord): Promise<void>
  savePreviousSourceCandidates(jobId: string, candidates: PreviousSourceCandidateRecord[]): Promise<void>
  completePreviousSourceOutcome(jobId: string, outcome: 'NOT_REQUIRED' | 'NOT_FOUND' | 'AMBIGUOUS'): Promise<void>
  completePreviousSourceVerified(jobId: string, input: {
    candidate: PreviousSourceCandidateRecord
    sourceUrl: string
    object: StoredBlob
    assets: PreviousSourceAssetInput[]
  }): Promise<void>
  markPreviousSourceAwaitingRetry(jobId: string, error: AiCallFailure): Promise<void>
  getPreviousSourceProgress(runId: string): Promise<{ total: number; completed: number; awaitingRetry: number }>
  markPreviousSourceStageAwaitingRetry(runId: string, message: string): Promise<void>
  requestPreviousSourceRetry(runId: string, requestKey: string): Promise<{ runId: string; commandId: string; status: 'QUEUED' }>
}
