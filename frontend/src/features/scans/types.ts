export type ScanRunStatus = 'QUEUED' | 'RUNNING' | 'AWAITING_RETRY' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED'

export type ScanStage =
  | 'DISCOVERING'
  | 'AI_FILTERING'
  | 'DOWNLOADING_DOCUMENTS'
  | 'DISCOVERING_ASSETS'
  | 'DOWNLOADING_ASSETS'
  | 'VALIDATING'
  | 'WRITING_MANIFEST'

export type StageExecutionStatus = 'PENDING' | 'RUNNING' | 'AWAITING_RETRY' | 'COMPLETED' | 'FAILED'

export interface ScanRunDetail {
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
    errorCategory: string | null
    errorMessage: string | null
  }
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
    status: StageExecutionStatus
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
      validationStatus: 'PENDING' | 'VALID' | 'INVALID'
      assetCount: number
      filter: null | {
        titleDecision: 'IN' | 'OUT' | 'MAYBE'
        finalDecision: 'IN' | 'OUT' | null
        reason: string
      }
    }>
  }>
}

export interface ScanRunSummary {
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

export const terminalScanStatuses = new Set<ScanRunStatus>([
  'AWAITING_RETRY',
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
])
