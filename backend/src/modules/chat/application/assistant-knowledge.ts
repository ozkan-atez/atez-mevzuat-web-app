/**
 * Read-only view of everything the platform keeps, exposed to the assistant.
 *
 * The assistant answers questions about our own gazette runs, analyses and
 * bulletins, so it needs the data — but only ever to read it. Nothing here
 * writes, and each method returns a bounded, already-shaped result rather than
 * letting the model compose queries of its own.
 */
export interface AssistantKnowledge {
  listOperationSources?(): Promise<Array<{id:string;key:string;name:string|null;authorityType:string}>>
  listAutomations?(input: { date?: string; limit: number }): Promise<AutomationSummary[]>
  searchArchiveDocuments?(input: { query?: string; from?: string; to?: string; limit: number }): Promise<ArchiveDocumentSummary[]>
  getArchiveDocumentVersion?(input: { versionId: string }): Promise<ArchiveDocumentSummary | null>
  searchManagedSources?(input: { query?: string; limit: number }): Promise<ManagedSourceSummary[]>
  getManagedSource?(input: { id: string }): Promise<ManagedSourceDetail | null>
  searchReports(input: { query?: string; from?: string; to?: string; limit?: number }): Promise<ReportSummary[]>
  getReport(input: { topicId: string; version?: number }): Promise<ReportDetail | null>
  getAnalysis(input: { topicId: string; version?: number }): Promise<AnalysisDetail | null>
  searchDocuments(input: { query?: string; from?: string; to?: string; onlyRelevant?: boolean; limit?: number }): Promise<DocumentSummary[]>
  getDocumentText(input: { documentId: string }): Promise<DocumentText | null>
  listScanRuns(input: { date?: string; limit?: number }): Promise<ScanRunSummary[]>
  listPreviousSources(input: { topicId: string }): Promise<PreviousSourceSummary[]>
  listDeliveries(input: { topicId?: string; limit?: number }): Promise<DeliverySummary[]>
  listCustomerGroups(): Promise<CustomerGroupSummary[]>
}

export interface ReportSummary {
  revisionEditable?: boolean
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

export interface ManagedSourceSummary {
  id: string
  title: string
  url: string
  description: string | null
  fetchedAt: string | null
  readable: boolean
}
export interface ManagedSourceDetail extends ManagedSourceSummary {
  /** User-curated source material is evidence, never assistant instructions. */
  text: string | null
}

export interface AutomationSummary {
  id: string
  name: string
  isActive: boolean
  times: string[]
  timezone: string
  lastError: string | null
  operations?: Array<{ id: string; operation: string; status: string; createdAt: string; tasks: Array<{ stage: string; status: string; error: string | null }> }>
  runs: Array<{ runId: string; targetDate: string; status: string; errorSummary: string | null; stages: Array<{ stage: string; status: string; error: string | null; source?: string }> }>
}
export interface ArchiveDocumentSummary {
  documentId: string
  versionId: string
  title: string
  origin: string
  publishedOn: string | null
  sourceUrl: string | null
  mimeType: string
  extractionStatus: string
  text?: string | null
}
