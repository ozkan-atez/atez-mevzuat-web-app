export type ScanRunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED'

export type ScanStage =
  | 'DISCOVERING'
  | 'DOWNLOADING_DOCUMENTS'
  | 'DISCOVERING_ASSETS'
  | 'DOWNLOADING_ASSETS'
  | 'VALIDATING'
  | 'WRITING_MANIFEST'

export type StageExecutionStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'

export interface ScanRunDetail {
  id: string
  status: ScanRunStatus
  currentStage: ScanStage | null
  targetDate: string
  startedAt: string | null
  completedAt: string | null
  errorSummary: string | null
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
    }>
  }>
}

export const terminalScanStatuses = new Set<ScanRunStatus>([
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
])
