export interface SourceOption { id: string; key: string; name: string; available: boolean; reason: string | null }
export interface SourceRun { id: string; targetDate: string; status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED'; errorSummary: string | null; hasReport: boolean; source: { name: string; key: string; authorityType: string }; documents: Array<{ id: string; title: string; url: string; feedUrl: string; publishedOn: string }> }

async function read<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string }
    throw new Error(body.message ?? 'Kaynak taraması yüklenemedi.')
  }
  return response.json() as Promise<T>
}
export async function sourceOptions(): Promise<SourceOption[]> { return (await read<{ sources: SourceOption[] }>('/api/v1/source-runs/sources')).sources }
export async function startSourceRun(sourceId: string, targetDate: string): Promise<{ runId: string }> {
  return read('/api/v1/source-runs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ sourceId, targetDate }) })
}
export async function getSourceRun(id: string): Promise<SourceRun> { return read(`/api/v1/source-runs/${encodeURIComponent(id)}`) }
export async function listSourceRuns(): Promise<Array<Pick<SourceRun, 'id' | 'targetDate' | 'status' | 'source'> & { _count: { documents: number } }>> { return (await read<{ runs: Array<Pick<SourceRun, 'id' | 'targetDate' | 'status' | 'source'> & { _count: { documents: number } }> }>('/api/v1/source-runs')).runs }
export async function retrySourceRun(id: string): Promise<void> { await read(`/api/v1/source-runs/${encodeURIComponent(id)}/retry`, { method: 'POST' }) }
