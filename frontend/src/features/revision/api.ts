import { apiFetch } from '../../lib/apiFetch'
import { ScanApiError } from '../scans/api'
import type { PublishedRevision, ReportDraftView, ReportFieldEditRecord } from './types'

export class DraftConflictError extends Error {
  readonly currentVersion: number

  constructor(currentVersion: number, message: string) {
    super(message)
    this.name = 'DraftConflictError'
    this.currentVersion = currentVersion
  }
}

async function readError(response: Response, fallback: string): Promise<never> {
  const payload = await response.json().catch(() => ({})) as { message?: string; currentVersion?: number; category?: string }
  if (response.status === 409 && payload.category !== 'REVISION_IN_PROGRESS' && typeof payload.currentVersion === 'number') {
    throw new DraftConflictError(payload.currentVersion, payload.message ?? fallback)
  }
  throw new ScanApiError(response.status, payload.message ?? fallback)
}

export async function getReportDraft(topicId: string): Promise<ReportDraftView> {
  const response = await apiFetch(`/api/v1/topics/${topicId}/draft`)
  if (!response.ok) await readError(response, 'Taslak alınamadı')
  return response.json() as Promise<ReportDraftView>
}

export async function applyReportEdits(topicId: string, input: {
  edits: Array<{ path: string; value: string | null }>
  expectedVersion?: number
}): Promise<ReportDraftView> {
  const response = await apiFetch(`/api/v1/topics/${topicId}/draft/edits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(input),
  })
  if (!response.ok) await readError(response, 'Değişiklik uygulanamadı')
  return response.json() as Promise<ReportDraftView>
}

export async function revertReportEdit(topicId: string, editId: string): Promise<ReportDraftView> {
  const response = await apiFetch(`/api/v1/topics/${topicId}/draft/edits/${editId}/revert`, { method: 'POST' })
  if (!response.ok) await readError(response, 'Değişiklik geri alınamadı')
  return response.json() as Promise<ReportDraftView>
}

export async function publishReportDraft(topicId: string, expectedVersion?: number): Promise<PublishedRevision> {
  const response = await apiFetch(`/api/v1/topics/${topicId}/draft/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(expectedVersion === undefined ? {} : { expectedVersion }),
  })
  if (!response.ok) await readError(response, 'Revizyon yayımlanamadı')
  return response.json() as Promise<PublishedRevision>
}

export async function discardReportDraft(topicId: string): Promise<void> {
  const response = await apiFetch(`/api/v1/topics/${topicId}/draft`, { method: 'DELETE' })
  if (!response.ok) await readError(response, 'Taslak iptal edilemedi')
}

export async function saveReportWorkspace(topicId: string, customization: import('./types').ReportCustomization, expectedVersion?: number): Promise<ReportDraftView> {
  const response = await apiFetch(`/api/v1/topics/${topicId}/draft/workspace`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ customization, expectedVersion }),
  })
  if (!response.ok) await readError(response, 'Rapor düzeni kaydedilemedi')
  return response.json() as Promise<ReportDraftView>
}

export async function addReportSource(topicId: string, source: import('./types').ReportSourceInput, expectedVersion?: number): Promise<ReportDraftView> {
  const response = await apiFetch(`/api/v1/topics/${topicId}/draft/sources`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ source, expectedVersion }),
  })
  if (!response.ok) await readError(response, 'Kaynak eklenemedi')
  return response.json() as Promise<ReportDraftView>
}

export async function applyReportTemplate(topicId: string, templateId: string, expectedVersion?: number): Promise<ReportDraftView> {
  const response = await apiFetch(`/api/v1/topics/${topicId}/draft/workspace`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ templateId, expectedVersion }),
  })
  if (!response.ok) await readError(response, 'Şablon uygulanamadı')
  return response.json() as Promise<ReportDraftView>
}

export interface SavedReportRevision { version: number; createdAt: string; edits: ReportFieldEditRecord[] }
export async function getReportDraftHistory(topicId: string): Promise<{ revisions: SavedReportRevision[] }> {
  const response = await apiFetch(`/api/v1/topics/${topicId}/draft/history`)
  if (!response.ok) await readError(response, 'Kaydedilmiş değişiklikler alınamadı.')
  return response.json() as Promise<{ revisions: SavedReportRevision[] }>
}
