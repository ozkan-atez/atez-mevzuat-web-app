export type ScanRunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED'

export type ScanStage =
  | 'DISCOVERING'
  | 'DOWNLOADING_DOCUMENTS'
  | 'DISCOVERING_ASSETS'
  | 'DOWNLOADING_ASSETS'
  | 'VALIDATING'
  | 'WRITING_MANIFEST'

export const scanStages: readonly ScanStage[] = [
  'DISCOVERING',
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
