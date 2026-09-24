import type { ScanRunDetail, ScanRunStatus, ScanRunSummary, ScheduleView } from './types'

export class ScanApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ScanApiError'
    this.status = status
  }
}

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json() as { message?: string }
    return body.message || fallback
  } catch {
    return fallback
  }
}

export async function createManualScan(targetDate: string, sourceKeys: string[] = ['resmi-gazete']): Promise<{
  runId: string
  status: ScanRunStatus
  targetDate: string
}> {
  const response = await fetch('/api/v1/scan-runs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ trigger: 'MANUAL', targetDate, sourceKeys }),
  })
  if (!response.ok) {
    throw new ScanApiError(response.status, await readError(response, 'Tarama başlatılamadı'))
  }
  return response.json() as Promise<{ runId: string; status: ScanRunStatus; targetDate: string }>
}

export async function getScanRun(runId: string): Promise<ScanRunDetail> {
  const response = await fetch(`/api/v1/scan-runs/${runId}`)
  if (!response.ok) {
    throw new ScanApiError(response.status, await readError(response, 'Tarama bilgileri alınamadı'))
  }
  return response.json() as Promise<ScanRunDetail>
}

export async function getRunReportHtml(runId: string, reportId: string): Promise<string> {
  const response = await fetch(`/api/v1/scan-runs/${runId}/reports/${reportId}/html`)
  if (!response.ok) throw new ScanApiError(response.status, await readError(response, 'Bülten içeriği alınamadı'))
  return response.text()
}

export interface RunReportReview {
  title: string
  version: number
  spec: { emptyDayText: string; source: { label: string; url: string } }
  html: string
  reviewStatus: 'READY' | 'PENDING_APPROVAL'
  draft: { baseVersion: number; spec: { emptyDayText: string }; html: string } | null
}

export async function getRunReportReview(runId: string, reportId: string): Promise<RunReportReview> {
  const response = await fetch(`/api/v1/scan-runs/${runId}/reports/${reportId}/review`)
  if (!response.ok) throw new ScanApiError(response.status, 'Rapor incelemesi yüklenemedi')
  return response.json() as Promise<RunReportReview>
}

export async function saveRunReportReview(runId: string, reportId: string, version: number, edits: Array<{ path: string; value: string }>): Promise<RunReportReview> {
  const response = await fetch(`/api/v1/scan-runs/${runId}/reports/${reportId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion: version, edits }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string }
    throw new ScanApiError(response.status, payload.message ?? 'Rapor kaydedilemedi')
  }
  return response.json() as Promise<RunReportReview>
}

export async function previewRunReportPrompt(runId: string, reportId: string, input: {
  expectedVersion: number
  message: string
}): Promise<{ version: number; reviewStatus: 'PENDING_APPROVAL'; edits: Array<{ path: 'emptyDayText'; value: string }>; html: string }> {
  const response = await fetch(`/api/v1/scan-runs/${runId}/reports/${reportId}/review/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new ScanApiError(response.status, await readError(response, 'Revizyon isteği işlenemedi'))
  return response.json() as Promise<{ version: number; reviewStatus: 'PENDING_APPROVAL'; edits: Array<{ path: 'emptyDayText'; value: string }>; html: string }>
}

export async function saveRunReportDraft(runId: string, reportId: string, version: number, value: string): Promise<{ draft: { spec: { emptyDayText: string }; html: string } }> {
  const response = await fetch(`/api/v1/scan-runs/${runId}/reports/${reportId}/review/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion: version, edits: [{ path: 'emptyDayText', value }] }),
  })
  if (!response.ok) throw new ScanApiError(response.status, await readError(response, 'Revizyon taslağı kaydedilemedi'))
  return response.json() as Promise<{ draft: { spec: { emptyDayText: string }; html: string } }>
}

export async function discardRunReportDraft(runId: string, reportId: string): Promise<void> {
  const response = await fetch(`/api/v1/scan-runs/${runId}/reports/${reportId}/review/draft`, { method: 'DELETE' })
  if (!response.ok) throw new ScanApiError(response.status, await readError(response, 'Revizyon iptal edilemedi'))
}

export async function retryAiFilter(runId: string): Promise<{ runId: string; status: 'QUEUED' }> {
  const response = await fetch(`/api/v1/scan-runs/${runId}/ai-filter/retry`, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  })
  if (!response.ok) {
    throw new ScanApiError(response.status, await readError(response, 'AI filtresi yeniden başlatılamadı'))
  }
  return response.json() as Promise<{ runId: string; status: 'QUEUED' }>
}

export async function retryScanRun(runId: string): Promise<{ runId: string; status: 'QUEUED' }> {
  const response = await fetch(`/api/v1/scan-runs/${runId}/retry`, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  })
  if (!response.ok) throw new ScanApiError(response.status, await readError(response, 'Tarama yeniden başlatılamadı'))
  return response.json() as Promise<{ runId: string; status: 'QUEUED' }>
}

export async function retryPreviousSources(runId: string): Promise<{ runId: string; status: 'QUEUED' }> {
  const response = await fetch(`/api/v1/scan-runs/${runId}/previous-sources/retry`, {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  })
  if (!response.ok) {
    throw new ScanApiError(response.status, await readError(response, 'Önceki kaynak işlemleri yeniden başlatılamadı'))
  }
  return response.json() as Promise<{ runId: string; status: 'QUEUED' }>
}

export async function listScanRuns(limit = 10): Promise<ScanRunSummary[]> {
  const response = await fetch(`/api/v1/scan-runs?limit=${limit}`)
  if (!response.ok) {
    throw new ScanApiError(response.status, await readError(response, 'Taramalar alınamadı'))
  }
  const body = await response.json() as { runs: ScanRunSummary[] }
  return body.runs
}

export async function getScanSchedule(date?: string): Promise<ScheduleView> {
  const response = await fetch(`/api/v1/scan-runs/schedule${date ? `?date=${date}` : ''}`)
  if (!response.ok) throw new ScanApiError(response.status, 'Tarama zamanlaması alınamadı')
  return response.json() as Promise<ScheduleView>
}
