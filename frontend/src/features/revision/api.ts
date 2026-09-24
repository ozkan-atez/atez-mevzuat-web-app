import { ScanApiError } from '../scans/api'
import type { PublishedRevision, ReportDraftView } from './types'

export class DraftConflictError extends Error {
  readonly currentVersion: number

  constructor(currentVersion: number, message: string) {
    super(message)
    this.name = 'DraftConflictError'
    this.currentVersion = currentVersion
  }
}

async function readError(response: Response, fallback: string): Promise<never> {
  const payload = await response.json().catch(() => ({})) as { message?: string; currentVersion?: number }
  if (response.status === 409 && typeof payload.currentVersion === 'number') {
    throw new DraftConflictError(payload.currentVersion, payload.message ?? fallback)
  }
  throw new ScanApiError(response.status, payload.message ?? fallback)
}

export async function getReportDraft(topicId: string): Promise<ReportDraftView> {
  const response = await fetch(`/api/v1/topics/${topicId}/draft`)
  if (!response.ok) await readError(response, 'Taslak alınamadı')
  return response.json() as Promise<ReportDraftView>
}

export async function applyReportEdits(topicId: string, input: {
  edits: Array<{ path: string; value: string | null }>
  expectedVersion?: number
}): Promise<ReportDraftView> {
  const response = await fetch(`/api/v1/topics/${topicId}/draft/edits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(input),
  })
  if (!response.ok) await readError(response, 'Değişiklik uygulanamadı')
  return response.json() as Promise<ReportDraftView>
}

export async function revertReportEdit(topicId: string, editId: string): Promise<ReportDraftView> {
  const response = await fetch(`/api/v1/topics/${topicId}/draft/edits/${editId}/revert`, { method: 'POST' })
  if (!response.ok) await readError(response, 'Değişiklik geri alınamadı')
  return response.json() as Promise<ReportDraftView>
}

export async function publishReportDraft(topicId: string, expectedVersion?: number): Promise<PublishedRevision> {
  const response = await fetch(`/api/v1/topics/${topicId}/draft/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(expectedVersion === undefined ? {} : { expectedVersion }),
  })
  if (!response.ok) await readError(response, 'Revizyon yayımlanamadı')
  return response.json() as Promise<PublishedRevision>
}

export async function discardReportDraft(topicId: string): Promise<void> {
  const response = await fetch(`/api/v1/topics/${topicId}/draft`, { method: 'DELETE' })
  if (!response.ok) await readError(response, 'Taslak iptal edilemedi')
}
