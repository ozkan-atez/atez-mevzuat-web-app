export interface SourceEndpoint {
  id: string
  url: string
  title: string
  reason: string | null
  status: 'PROPOSED' | 'ACTIVE' | 'REJECTED'
  managedSourceId: string | null
}

export interface SourceSite {
  id: string
  key: string
  name: string | null
  baseUrl: string
  authorityType: string
  isActive: boolean
  endpoints: SourceEndpoint[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/source-sites${path}`, init)
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string }
    throw new Error(body.message ?? 'Kaynak keşfi tamamlanamadı.')
  }
  return response.json() as Promise<T>
}

export async function listSourceSites(): Promise<SourceSite[]> {
  return (await request<{ sites: SourceSite[] }>('/')).sites
}

export function addSourceSite(input: { title: string; url: string }): Promise<SourceSite> {
  return request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function discoverSourceSite(id: string): Promise<{ examined: number; suggested: number; aiUsed: boolean; endpoints: SourceEndpoint[] }> {
  return request(`/${encodeURIComponent(id)}/discover`, { method: 'POST' })
}

export function decideSourceEndpoint(siteId: string, endpointId: string, decision: 'activate' | 'reject'): Promise<SourceEndpoint> {
  return request(`/${encodeURIComponent(siteId)}/endpoints/${encodeURIComponent(endpointId)}/${decision}`, { method: 'POST' })
}
