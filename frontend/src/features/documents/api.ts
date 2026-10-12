import { apiFetch } from '../../lib/apiFetch'
export interface DocumentVersion { id: string; mimeType: string; extractionStatus: string; originalFilename: string | null; createdAt: string }
export interface ArchiveDocument { canonicalUrl?: string | null; id: string; title: string; origin: string; publishedOn: string | null; latestVersion: DocumentVersion | null; versions: DocumentVersion[] }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`/api/v1/${path}`, init)
  const body = await response.json()
  if (!response.ok) throw new Error(body.message ?? 'Belge işlemi tamamlanamadı.')
  return body as T
}
export function listDocuments(query = '', options: { page?:number; limit?:number; from?:string; to?:string } = {}) { const params = new URLSearchParams({query,...Object.fromEntries(Object.entries(options).filter(([,value])=>value!==undefined&&value!=='').map(([key,value])=>[key,String(value)]))}); return request<{ documents: ArchiveDocument[]; total: number }>(`documents?${params}`) }
export async function uploadDocument(file: File) {
  const data = new FormData(); data.append('file', file)
  return request<{ document: ArchiveDocument; version: DocumentVersion }>('documents/uploads', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: data })
}
export function importDocument(body: { kind: 'TEXT'; title: string; text: string } | { kind: 'URL'; title?: string; url: string }) {
  return request<{ document: ArchiveDocument; version: DocumentVersion }>('documents/imports', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) })
}
export function getDocumentContent(id: string) { return request<{ id: string; text: string | null; status: string; metadata: unknown }>(`document-versions/${encodeURIComponent(id)}/content`) }

export function documentStatusLabel(status: string | undefined) { return ({ READY: 'Metin hazır', EXTRACTED: 'Metin hazır', OCR_REQUIRED: 'Görsel okuma gerekiyor', FAILED: 'Okunamadı', PENDING: 'Okuma bekliyor' } as Record<string, string>)[status ?? ''] ?? 'Metin henüz hazır değil' }
