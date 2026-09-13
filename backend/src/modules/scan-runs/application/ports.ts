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
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
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
    }>
  }>
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
}

export interface ObjectStore {
  ensureBucket(): Promise<void>
  putContent(file: DownloadedFile): Promise<StoredBlob>
  putRunFile(key: string, body: Buffer, mediaType: string): Promise<StoredBlob>
  exists(key: string): Promise<boolean>
}

export interface OfficialHttp {
  download(url: string, tempDirectory: string): Promise<DownloadedFile>
}

export interface ScanQueue {
  enqueue(runId: string): Promise<string>
}

export interface ScanRepository {
  createManualRun(input: { requestKey: string; targetDate: string }): Promise<{ id: string; status: ScanRunStatus; targetDate: string }>
  getRun(runId: string): Promise<ScanRunDetailDto | null>
  getExecutionRun(runId: string): Promise<{ id: string; targetDate: string; downloadedBytes: bigint } | null>
  saveIndex(runId: string, sourceUrl: string, object: StoredBlob): Promise<void>
  saveEditions(runId: string, targetDate: string, editions: DiscoveredEdition[]): Promise<void>
  listDocuments(runId: string): Promise<Array<{ id: string; sourceUrl: string; title: string }>>
  saveAssets(documentId: string, assets: DiscoveredAsset[]): Promise<void>
  listAssets(runId: string): Promise<Array<{ id: string; documentId: string; sourceUrl: string }>>
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
}
