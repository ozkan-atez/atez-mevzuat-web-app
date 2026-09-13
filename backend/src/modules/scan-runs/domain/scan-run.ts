export type ScanRunStatus = 'QUEUED' | 'RUNNING' | 'AWAITING_RETRY' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED'

export type ScanStage =
  | 'DISCOVERING'
  | 'AI_FILTERING'
  | 'DOWNLOADING_DOCUMENTS'
  | 'DISCOVERING_ASSETS'
  | 'DOWNLOADING_ASSETS'
  | 'VALIDATING'
  | 'WRITING_MANIFEST'

export const scanStages: readonly ScanStage[] = [
  'DISCOVERING',
  'AI_FILTERING',
  'DOWNLOADING_DOCUMENTS',
  'DISCOVERING_ASSETS',
  'DOWNLOADING_ASSETS',
  'VALIDATING',
  'WRITING_MANIFEST',
]

export function assertStageTransition(from: ScanStage, to: ScanStage): void {
  if (scanStages.indexOf(to) !== scanStages.indexOf(from) + 1) {
    throw new Error(`Invalid stage transition: ${from} -> ${to}`)
  }
}
