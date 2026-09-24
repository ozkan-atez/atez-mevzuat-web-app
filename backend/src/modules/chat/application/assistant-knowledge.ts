/**
 * Read-only view of everything the platform keeps, exposed to the assistant.
 *
 * The assistant answers questions about our own gazette runs, analyses and
 * bulletins, so it needs the data — but only ever to read it. Nothing here
 * writes, and each method returns a bounded, already-shaped result rather than
 * letting the model compose queries of its own.
 */
export interface AssistantKnowledge {
  searchReports(input: { query?: string; from?: string; to?: string; limit?: number }): Promise<ReportSummary[]>
  getReport(input: { topicId?: string; reportId?: string; version?: number }): Promise<ReportDetail | null>
  dailyReports(input: { date: string }): Promise<DailyRunReport[]>
  reportFiles(input: { topicId?: string; reportId?: string; version?: number }): Promise<ReportFiles | null>
  revisionHistory(input: { topicId?: string; reportId?: string }): Promise<RevisionHistory | null>
  draftChanges(input: { topicId?: string; reportId?: string }): Promise<DraftChanges | null>
  documentConnections(input: { documentId: string }): Promise<DocumentConnections | null>
  scanStages(input: { runId: string }): Promise<ScanStages | null>
  searchOfficial(input: { query: string; endDate?: string; limit: number }): Promise<OfficialSearchResult>
  getOfficialDocument(input: { sourceUrl: string; title?: string; publicationDate?: string }): Promise<OfficialDocument | null>
  getAnalysis(input: { topicId: string; version?: number }): Promise<AnalysisDetail | null>
  searchDocuments(input: { query?: string; from?: string; to?: string; onlyRelevant?: boolean; limit?: number }): Promise<DocumentSummary[]>
  getDocumentText(input: { documentId: string }): Promise<DocumentText | null>
  listScanRuns(input: { date?: string; limit?: number }): Promise<ScanRunSummary[]>
  getRunContents(input: { runId: string }): Promise<RunContents | null>
  listPreviousSources(input: { topicId: string }): Promise<PreviousSourceSummary[]>
  listDeliveries(input: { topicId?: string; limit?: number }): Promise<DeliverySummary[]>
  listCustomerGroups(): Promise<CustomerGroupSummary[]>
  searchManagedSources(input: { query?: string; limit: number }): Promise<ManagedSourceSummary[]>
  getManagedSource(input: { id: string }): Promise<ManagedSourceDetail | null>
}

export interface ManagedSourceSummary {
  id: string
  title: string
  url: string
  description: string | null
  fetchedAt: string | null
  readable: boolean
}

export interface ManagedSourceDetail extends ManagedSourceSummary {
  text: string | null
}

export interface ReportSummary {
  reportId?: string
  runId?: string
  topicId: string
  title: string
  card: string
  version: number
  gazetteDate: string
  issueNumber: string
  summary: string
  sourceUrl: string
  reportUrl: string
  publishedAt: string
}

export interface ReportDetail extends ReportSummary {
  /** The bulletin as readable text, rendered from its stored spec. */
  content: string
  pendingDraftChanges: number
  reviewStatus?: string
  pendingDraft?: { baseVersion: number; content: string; changes: number } | null
}

export interface DailyRunReport {
  runId: string
  status: string
  reports: Array<{ reportId: string; topicId: string | null; title: string; version: number; status: string; reviewStatus: string; reportUrl: string }>
}

export interface ReportFiles {
  reportId: string
  version: number
  previewHtmlUrl: string
  htmlUrl: string
  pdfUrl: string
  reportUrl: string
}

export interface RevisionHistory {
  reportId: string
  reviewStatus: string
  reportRevisions: Array<{ version: number; status: string; createdAt: string; request: string | null }>
  analysisRevisions: Array<{ version: number; status: string; createdAt: string; request: string | null }>
}

export interface DraftChanges {
  reportId: string
  reviewStatus: string
  baseVersion: number | null
  changes: Array<{ sequence: number; path: string; previousValue: unknown; nextValue: unknown; source: string; reverted: boolean; createdAt: string }>
  pendingContent?: string
}

export interface DocumentConnections {
  documentId: string
  title: string
  sourceUrl: string
  filterDecision: string | null
  filterReason: string | null
  assets: Array<{ sourceUrl: string; role: string }>
  topicId: string | null
  analyses: Array<{ version: number; status: string }>
  reports: Array<{ reportId: string; version: number; reportUrl: string }>
  previousSources: PreviousSourceSummary[]
}

export interface ScanStages {
  runId: string
  status: string
  currentStage: string | null
  errorSummary: string | null
  stages: Array<{ stage: string; status: string; error: string | null }>
  failedFetches: Array<{ url: string; status: string; error: string | null }>
}

export interface OfficialSearchResult {
  origin: 'archive' | 'official'
  candidates: Array<{ title: string; publicationDate: string; sourceUrl: string; documentId?: string; requiresResolution?: boolean }>
}

export interface OfficialDocument {
  title: string
  sourceUrl: string
  mediaType: string
  text: string | null
  note?: string
  fetchedAt?: string
}

export interface AnalysisDetail {
  topicId: string
  version: number
  status: string
  markdown: string
  createdAt: string
}

export interface DocumentSummary {
  documentId: string
  title: string
  publicationDate: string
  editionType: string
  sourceUrl: string
  filterDecision: string | null
  filterReason: string | null
  hasTopic: boolean
  mediaType: string | null
}

export interface DocumentText {
  documentId: string
  title: string
  sourceUrl: string
  mediaType: string
  /** Null when the stored file is a PDF, whose text we do not extract here. */
  text: string | null
  note?: string
}

export interface ScanRunSummary {
  runId: string
  targetDate: string
  trigger: string
  status: string
  currentStage: string | null
  startedAt: string | null
  completedAt: string | null
  documents: number
  relevantDocuments: number
  reports: number
  errorSummary: string | null
}

export interface RunContents {
  runId: string
  targetDate: string
  status: string
  totalDocuments: number
  reports: Array<{ reportId: string; title: string; version: number; reportUrl: string; sourceUrl: string | null }>
  relevantDocuments: Array<{ documentId: string; title: string; sourceUrl: string }>
  gazetteIndexes: string[]
}

export interface PreviousSourceSummary {
  title: string
  publicationDate: string
  gazetteNo: string | null
  sourceUrl: string
}

export interface DeliverySummary {
  topicId: string
  reportVersion: number
  subject: string
  recipients: number
  status: string
  sentAt: string | null
  errorMessage: string | null
}

export interface CustomerGroupSummary {
  name: string
  description: string | null
  recipients: number
  isActive: boolean
}
