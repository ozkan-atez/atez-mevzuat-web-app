import { apiFetch } from '../../lib/apiFetch'

export interface ReportListRow {
  id: string; title: string; runId: string | null; topicId: string | null; version: number
  targetDate: string | null; publishedAt: string; standalone: boolean
  origin: 'AUTOMATION' | 'MANUAL' | 'UNKNOWN'
  contentType: 'LEGISLATION' | 'DOCUMENT' | 'NO_CHANGE'
  automationId: string | null; automationName: string | null
  initiatedBy: { id: string; name: string | null } | null; sources: string[]
}
export async function listReports(query: Record<string, string | number>, signal?: AbortSignal): Promise<{ reports: ReportListRow[]; total: number }> {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))
  const response = await apiFetch(`/api/v1/reports?${params}`, { signal })
  const body = await response.json()
  if (!response.ok) throw new Error(body.message ?? 'Raporlar alınamadı.')
  return body
}
