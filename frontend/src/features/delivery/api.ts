import { ScanApiError } from '../scans/api'
import type { CustomerGroup, DeliveryContext, DispatchResult } from './types'

async function errorMessage(response: Response, fallback: string) {
  try { return ((await response.json()) as { message?: string }).message ?? fallback }
  catch { return fallback }
}

export async function getDeliveryContext(topicId: string, version: number): Promise<DeliveryContext> {
  const response = await fetch(`/api/v1/topics/${topicId}/reports/${version}/delivery`)
  if (!response.ok) throw new ScanApiError(response.status, await errorMessage(response, 'Dağıtım bilgileri alınamadı'))
  return response.json() as Promise<DeliveryContext>
}

export function reportPdfUrl(topicId: string, version: number): string {
  return `/api/v1/topics/${topicId}/reports/${version}/pdf`
}

/**
 * Fetches the PDF as a blob rather than pointing the browser at the URL, so a
 * server-side failure surfaces as an in-app error instead of a blank tab.
 */
export async function downloadReportPdf(topicId: string, version: number): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetch(reportPdfUrl(topicId, version))
  if (!response.ok) throw new ScanApiError(response.status, await errorMessage(response, 'PDF oluşturulamadı'))
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const match = /filename="([^"]+)"/.exec(disposition)
  return { blob: await response.blob(), fileName: match?.[1] ?? 'ATEZ_Mevzuat_Bulteni.pdf' }
}

export async function sendDispatch(topicId: string, input: {
  reportVersion: number
  groupIds: string[]
  recipients: string[]
  subject: string
  bodyText: string
  attachPdf: boolean
}): Promise<DispatchResult> {
  const response = await fetch(`/api/v1/topics/${topicId}/dispatches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(input),
  })
  const payload = await response.json().catch(() => ({})) as DispatchResult & { message?: string }
  if (!response.ok) throw new ScanApiError(response.status, payload.message ?? 'E-posta gönderilemedi')
  return payload
}

export async function listCustomerGroups(): Promise<CustomerGroup[]> {
  const response = await fetch('/api/v1/customer-groups')
  if (!response.ok) throw new ScanApiError(response.status, await errorMessage(response, 'Müşteri grupları alınamadı'))
  return (await response.json() as { groups: CustomerGroup[] }).groups
}

export async function createCustomerGroup(input: { name: string; description: string | null; emails: string[] }): Promise<CustomerGroup> {
  const response = await fetch('/api/v1/customer-groups', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  if (!response.ok) throw new ScanApiError(response.status, await errorMessage(response, 'Grup oluşturulamadı'))
  return response.json() as Promise<CustomerGroup>
}

export async function updateCustomerGroup(id: string, input: Partial<{ name: string; description: string | null; emails: string[]; isActive: boolean }>): Promise<CustomerGroup> {
  const response = await fetch(`/api/v1/customer-groups/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  if (!response.ok) throw new ScanApiError(response.status, await errorMessage(response, 'Grup güncellenemedi'))
  return response.json() as Promise<CustomerGroup>
}

export async function deleteCustomerGroup(id: string): Promise<void> {
  const response = await fetch(`/api/v1/customer-groups/${id}`, { method: 'DELETE' })
  if (!response.ok) throw new ScanApiError(response.status, await errorMessage(response, 'Grup silinemedi'))
}

export function parseEmailList(value: string): string[] {
  return value.split(/[,;\n]/).map((item) => item.trim().toLowerCase()).filter(Boolean)
}
