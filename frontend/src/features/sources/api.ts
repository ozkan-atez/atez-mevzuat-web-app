export interface ManagedSource {
  id: string
  url: string
  title: string
  description: string | null
  keywords: string | null
  contentText: string | null
  contentType: string | null
  fetchError: string | null
  fetchedAt: string | null
  useInChat: boolean
  useInRuns: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type ManagedSourceInput = Pick<ManagedSource, 'url' | 'title' | 'description' | 'keywords' | 'useInChat' | 'useInRuns' | 'isActive'>

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/managed-sources${path}`, init)
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string }
    throw new Error(body.message ?? 'Kaynak işlemi tamamlanamadı.')
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

export async function listManagedSources(): Promise<ManagedSource[]> {
  return (await request<{ sources: ManagedSource[] }>('/')).sources
}

export function createManagedSource(input: ManagedSourceInput): Promise<ManagedSource> {
  return request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function updateManagedSource(id: string, input: ManagedSourceInput): Promise<ManagedSource> {
  return request(`/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function refreshManagedSource(id: string): Promise<ManagedSource> {
  return request(`/${encodeURIComponent(id)}/refresh`, { method: 'POST' })
}

export function deactivateManagedSource(id: string): Promise<void> {
  return request(`/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
