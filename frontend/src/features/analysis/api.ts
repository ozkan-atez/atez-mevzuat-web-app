import { ScanApiError } from '../scans/api'
import type { TopicDetail } from './types'

async function errorMessage(response: Response, fallback: string) {
  try { return ((await response.json()) as { message?: string }).message ?? fallback }
  catch { return fallback }
}

export async function getTopic(topicId: string): Promise<TopicDetail> {
  const response = await fetch(`/api/v1/topics/${topicId}`)
  if (!response.ok) throw new ScanApiError(response.status, await errorMessage(response, 'Topic alınamadı'))
  return response.json() as Promise<TopicDetail>
}

export async function sendTopicMessage(topicId: string, message: string) {
  const response = await fetch(`/api/v1/topics/${topicId}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ message }),
  })
  if (!response.ok) throw new ScanApiError(response.status, await errorMessage(response, 'Revizyon talebi gönderilemedi'))
  return response.json() as Promise<{ messageId: string; status: 'QUEUED'; revisionKind: 'ANALYSIS' | 'PUBLICATION' }>
}

export async function retryTopicAnalysis(topicId: string) {
  const response = await fetch(`/api/v1/topics/${topicId}/retry`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } })
  if (!response.ok) throw new ScanApiError(response.status, await errorMessage(response, 'Topic analizi yeniden başlatılamadı'))
  return response.json() as Promise<{ topicId: string; commandId: string; status: 'QUEUED' }>
}

export async function getTopicReportHtml(topicId: string, version: number): Promise<string> {
  const response = await fetch(`/api/v1/topics/${topicId}/reports/${version}/html`)
  if (!response.ok) throw new ScanApiError(response.status, await errorMessage(response, 'Rapor içeriği alınamadı'))
  return response.text()
}
