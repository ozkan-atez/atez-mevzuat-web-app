import type { OperationRequest } from '../operations/api'
import { workspaceRequest } from './api'
export type SourceDocumentProcessingStatus = 'PENDING' | 'FILTERING' | 'EXCLUDED' | 'ANALYZING' | 'COMPLETED' | 'FAILED'
export interface SourceRunCounters { found: number; relevant: number; excluded: number; failed: number; readyReports: number }
export interface CapturedSourceFile { url:string;title:string;role:string;status:'STORED'|'FAILED';mediaType?:string;byteSize?:number;sha256?:string;error?:string }
export interface SourceRunDocument {
  captureStatus?:string; captureError?:string|null; capturedFiles?:CapturedSourceFile[]|null
  id: string; title: string; url: string; publishedOn: string | null; feedUrl: string | null; contentText?: string | null
  filterDecision: 'IN' | 'OUT' | null; filterReason: string | null
  processingStatus: SourceDocumentProcessingStatus; processingError: string | null
  topicId: string | null; reportVersion: number | null
}
export interface SourceRunSummary {
  id: string; targetDate: string; status: string; source: { name: string; key: string }
  _count: { documents: number }; scanRunId: string | null; canAnalyze?: boolean; counters?: SourceRunCounters
}
export interface SourceRunDetailData extends SourceRunSummary { errorSummary: string | null; documents: SourceRunDocument[]; operations?: OperationRequest[] }
export const listSourceRuns = () => workspaceRequest<{ runs: SourceRunSummary[] }>('source-scan-runs')
export const getSourceRun = (id: string) => workspaceRequest<SourceRunDetailData>(`source-scan-runs/${id}`)
export interface SourceAnalyzeResult { runId?: string; status: string; operationRequestIds?: string[]; missing?: unknown[] }
export const analyzeSourceRun = (id: string, idempotencyKey: string = crypto.randomUUID()) => workspaceRequest<SourceAnalyzeResult>(`source-scan-runs/${id}/analyze`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey } })
export const retrySourceRun = (id: string) => workspaceRequest(`source-scan-runs/${id}/retry`, { method: 'POST' })
export function hasPublishedSourceReport(document: SourceRunDocument): boolean { return Boolean(document.topicId && document.reportVersion && document.processingStatus === 'COMPLETED' && document.filterDecision === 'IN') }
export function countSourceDocuments(documents: SourceRunDocument[]): SourceRunCounters {
  return { found: documents.length, relevant: documents.filter((document) => document.filterDecision === 'IN').length, excluded: documents.filter((document) => document.filterDecision === 'OUT' || document.processingStatus === 'EXCLUDED').length, failed: documents.filter((document) => document.processingStatus === 'FAILED').length, readyReports: documents.filter(hasPublishedSourceReport).length }
}
export const SOURCE_RUN_LABELS: Record<string, string> = { COMPLETED: 'Tamamlandı', FAILED: 'Başarısız', PARTIAL: 'Kısmi', QUEUED: 'Sırada', RUNNING: 'Tarama ve AI işlemleri sürüyor' }
export function sourceDocumentState(document: SourceRunDocument): { label: string; color: string } {
  if (document.processingStatus === 'FAILED') return { label: 'İşlem başarısız', color: 'error' }
  if (document.filterDecision === 'OUT' || document.processingStatus === 'EXCLUDED') return { label: 'Kapsam dışı', color: 'default' }
  if (hasPublishedSourceReport(document)) return { label: 'Rapor hazır', color: 'success' }
  if (document.processingStatus === 'ANALYZING' || document.filterDecision === 'IN') return { label: 'İlgili · rapor hazırlanıyor', color: 'processing' }
  if (document.processingStatus === 'FILTERING') return { label: 'AI değerlendiriyor', color: 'processing' }
  return { label: 'AI değerlendirmesi bekliyor', color: 'default' }
}
