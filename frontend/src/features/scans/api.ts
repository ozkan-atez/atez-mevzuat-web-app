import type { ScanRunDetail, ScanRunStatus, ScanRunSummary } from './types'

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

export async function createManualScan(targetDate: string): Promise<{
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
    body: JSON.stringify({ trigger: 'MANUAL', targetDate }),
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
