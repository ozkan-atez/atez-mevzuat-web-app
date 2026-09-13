import type { ScanRunDetail, ScanRunStatus } from './types'

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
