import { apiFetch } from '../../lib/apiFetch'
import type { OperationMode } from './OperationModeSelect'
export interface OperationTask { id: string; status: string; operation: string; reused: boolean; errorCategory?: string | null; errorMessage?: string | null; artifacts: { kind: string; referenceId?: string | null; objectKey?: string; data?: unknown }[] }
export interface OperationRequest { id: string; status: string; operation: string; mode: OperationMode; tasks: OperationTask[] }
export interface OperationInput { operation: 'EXTRACT' | 'ANALYZE' | 'BUILD_REPORT' | 'TARIFF_LOOKUP' | 'DISCOVER' | 'CAPTURE' | 'REVISE_ANALYSIS' | 'REVISE_REPORT' | 'FILTER' | 'PREVIOUS_SOURCES'; mode: OperationMode; documentVersionIds: string[]; documentRoles?: Record<string, 'PRIMARY' | 'ATTACHMENT' | 'PREVIOUS' | 'TARIFF' | 'SUPPORTING'>; evidenceTaskIds?: string[]; instruction?: string; analysisTaskId?: string; templateId?: string; reportTaskId?: string; sourceId?: string; code?: string; previousDate?: string; origin?: string; date?: string; datePolicy?: string; url?: string; reportEdits?: { title?: string; summary?: string; detailedAnalysis?: string } }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`/api/v1/${path}`, init); const body = await response.json()
  if (!response.ok) throw new Error(body.message ?? 'İşlem tamamlanamadı.')
  return body as T
}
export const getOperation = (id: string) => request<OperationRequest>(`operations/${encodeURIComponent(id)}`)
export const startOperation = (input: OperationInput) => request<OperationRequest>('operations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(input) })
export const cancelOperation = (id: string) => request<OperationRequest>(`operations/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
export const retryTask = (id: string) => request<unknown>(`operation-tasks/${encodeURIComponent(id)}/retry`, { method: 'POST' })
