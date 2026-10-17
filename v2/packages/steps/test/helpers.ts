import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { FetchRequest, FetchResponse, HttpFetcher } from '@atez/platform'

export const fx = (name: string) => readFileSync(fileURLToPath(new URL(`../../modules/test/fixtures/rg/${name}`, import.meta.url)))

/** RG sitesinin fixture'larla taklidi; ETag ile koşullu istekleri destekler. */
export class FakeRg implements HttpFetcher {
  requests: FetchRequest[] = []
  searches: { genelaranacakkelime?: string; genelbitistarihi?: string }[] = []
  /** /Home/Filter yanıtı: terim + bitiş tarihi → satırlar. */
  searchResults: (term: string, through: string) => unknown[] = () => []
  dayOverride = new Map<string, Buffer>()
  constructor(private readonly pdf: Buffer) {}
  async fetch(req: FetchRequest): Promise<FetchResponse> {
    this.requests.push(req)
    const u = new URL(req.url)
    const ok = (body: Buffer, contentType: string, etag: string | null = null): FetchResponse => {
      if (etag && req.etag === etag) return { url: req.url, status: 304, notModified: true, headers: { etag, lastModified: null, contentType, location: null }, body: Buffer.alloc(0) }
      return { url: req.url, status: 200, notModified: false, headers: { etag, lastModified: null, contentType, location: null }, body }
    }
    const day = u.pathname.match(/^\/(\d{2})\.(\d{2})\.(\d{4})$/)
    if (day) {
      const iso = `${day[3]}-${day[2]}-${day[1]}`
      const body = this.dayOverride.get(iso) ?? fx(`day-${iso}.html`)
      return ok(body, 'text/html; charset=utf-8')
    }
    if (u.pathname === '/fihrist') {
      try {
        return ok(fx(`fihrist-${u.searchParams.get('tarih')}-m${u.searchParams.get('mukerrer')}.html`), 'text/html; charset=utf-8')
      } catch {
        return { url: req.url, status: 302, notModified: false, headers: { etag: null, lastModified: null, contentType: null, location: '/' }, body: Buffer.alloc(0) }
      }
    }
    if (u.pathname === '/Home/Filter' && req.method === 'POST') {
      const body = JSON.parse(req.body ?? '{}') as { parameters?: { genelaranacakkelime?: string; genelbitistarihi?: string }; start?: number }
      this.searches.push(body.parameters ?? {})
      const data = (body.start ?? 0) === 0 ? this.searchResults(body.parameters?.genelaranacakkelime ?? '', body.parameters?.genelbitistarihi ?? '') : []
      return ok(Buffer.from(JSON.stringify({ draw: 1, recordsTotal: data.length, recordsFiltered: data.length, data })), 'application/json')
    }
    if (u.pathname.endsWith('.htm')) return ok(fx('doc-20251231-9.htm'), 'text/html', `"htm-${u.pathname}"`)
    if (u.pathname.endsWith('.pdf')) return ok(this.pdf, 'application/pdf', `"pdf-${u.pathname}"`)
    return { url: req.url, status: 404, notModified: false, headers: { etag: null, lastModified: null, contentType: null, location: null }, body: Buffer.alloc(0) }
  }
  reset() {
    this.requests = []
  }
}

