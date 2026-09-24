export type TopicStatus = 'QUEUED' | 'ANALYZING' | 'ANALYZED' | 'RENDERING' | 'VALIDATING' | 'COMPLETED' | 'AWAITING_RETRY' | 'BLOCKED' | 'FAILED'
export type ReportCard = 'K1' | 'K2' | 'K3' | 'K4' | 'K5' | 'K6'

export interface TopicSummary {
  id: string
  documentId: string
  title: string
  status: TopicStatus
  retryAvailable: boolean
  errorCategory: string | null
  errorMessage: string | null
  analysisVersion: number | null
  reportVersion: number | null
  reportCard: ReportCard | null
  reportBasename: string | null
}

export interface TopicMessage {
  id: string
  role: 'SYSTEM' | 'USER' | 'ASSISTANT'
  kind: 'AUTOMATED_ANALYSIS' | 'REVISION_REQUEST' | 'REVISION_RESULT' | 'ERROR'
  revisionKind: 'ANALYSIS' | 'PUBLICATION' | null
  content: string
  createdAt: string
}

export interface TopicDetail extends TopicSummary {
  runId: string
  sourceUrl: string
  latestAnalysis: null | { id: string; version: number; status: string; createdAt: string }
  latestReport: null | { id: string; version: number; card: ReportCard; basename: string; createdAt: string }
  analyses: Array<{ id: string; version: number; status: string; createdAt: string }>
  reports: Array<{ id: string; version: number; card: ReportCard; basename: string; createdAt: string }>
  thread: { id: string | null; messages: TopicMessage[] }
}
