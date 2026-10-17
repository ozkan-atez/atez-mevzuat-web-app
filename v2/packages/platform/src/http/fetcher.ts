import { PermanentError, TransientError } from '../errors'

/**
 * Kaynak HTTP istemcisi. Koşullu istekleri (ETag / Last-Modified) destekler (§5.3 basamak 2).
 * Ek B.2'deki SSRF-güvenli fetch'in (DNS pinleme, public IP) tam sürümü sonraki aşamada;
 * şimdilik host allow-list ve yalnızca https zorunlu.
 */
export interface FetchRequest {
  url: string
  etag?: string | null
  lastModified?: string | null
  method?: 'GET' | 'HEAD' | 'POST'
  body?: string
  contentType?: string
  accept?: string
  /** Yönlendirmeyi takip etme; 3xx yanıtı olduğu gibi dön (ör. RG'de olmayan mükerrer → 302). */
  noFollow?: boolean
}

export interface FetchResponse {
  url: string
  status: number
  notModified: boolean
  headers: { etag: string | null; lastModified: string | null; contentType: string | null; location: string | null }
  body: Buffer
}

export interface HttpFetcher {
  fetch(req: FetchRequest): Promise<FetchResponse>
}

export interface HttpFetcherOptions {
  allowedHosts: string[]
  timeoutMs?: number
  userAgent?: string
  maxBytes?: number
  /** Aynı host'a ardışık istekler arası bekleme (oran sınırı). */
  minIntervalMs?: number
}

export class SafeHttpFetcher implements HttpFetcher {
  private lastRequestAt = new Map<string, number>()
  constructor(private readonly opts: HttpFetcherOptions) {}

  async fetch(req: FetchRequest): Promise<FetchResponse> {
    const url = new URL(req.url)
    if (url.protocol !== 'https:') throw new PermanentError(`Yalnızca https: ${req.url}`, 'HTTP_SCHEME')
    if (!this.opts.allowedHosts.includes(url.hostname)) throw new PermanentError(`İzin verilmeyen host: ${url.hostname}`, 'HTTP_HOST')
    await this.throttle(url.hostname)
    const headers: Record<string, string> = { 'user-agent': this.opts.userAgent ?? 'ATEZ-Mevzuat-Radari/2.0' }
    if (req.etag) headers['if-none-match'] = req.etag
    if (req.lastModified) headers['if-modified-since'] = req.lastModified
    if (req.contentType) headers['content-type'] = req.contentType
    if (req.accept) headers.accept = req.accept
    let res: Response
    try {
      res = await fetch(url, {
        method: req.method ?? 'GET',
        headers,
        ...(req.body !== undefined ? { body: req.body } : {}),
        redirect: req.noFollow ? 'manual' : 'follow',
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 60_000),
      })
    } catch (err) {
      throw new TransientError(`Ağ hatası: ${req.url}: ${String(err)}`, 'HTTP_NETWORK', { cause: err })
    }
    if (res.status === 429 || res.status >= 500) throw new TransientError(`HTTP ${res.status}: ${req.url}`, 'HTTP_STATUS')
    let body: Buffer
    try {
      body = res.status === 304 || req.method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await res.arrayBuffer())
    } catch (err) {
      // Gövde okunurken zaman aşımı / bağlantı kopması da geçicidir.
      throw new TransientError(`Gövde okunamadı: ${req.url}: ${String(err)}`, 'HTTP_BODY', { cause: err })
    }
    const max = this.opts.maxBytes ?? 200 * 1024 * 1024
    if (body.length > max) throw new PermanentError(`Dosya sınırı aşıldı (${body.length} B): ${req.url}`, 'HTTP_TOO_LARGE')
    return {
      url: res.url || req.url,
      status: res.status,
      notModified: res.status === 304,
      headers: {
        etag: res.headers.get('etag'),
        lastModified: res.headers.get('last-modified'),
        contentType: res.headers.get('content-type'),
        location: res.headers.get('location'),
      },
      body,
    }
  }

  private async throttle(host: string): Promise<void> {
    const min = this.opts.minIntervalMs ?? 0
    if (!min) return
    const last = this.lastRequestAt.get(host) ?? 0
    const wait = last + min - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.lastRequestAt.set(host, Date.now())
  }
}

/** Fixture tabanlı sahte istemci (testler). Anahtar: tam URL. */
export class FixtureHttpFetcher implements HttpFetcher {
  readonly requests: FetchRequest[] = []
  constructor(
    private readonly routes: Map<string, { status?: number; body?: Buffer | string; etag?: string; lastModified?: string; contentType?: string; location?: string }>,
  ) {}
  async fetch(req: FetchRequest): Promise<FetchResponse> {
    this.requests.push(req)
    const r = this.routes.get(req.url)
    if (!r) return { url: req.url, status: 404, notModified: false, headers: { etag: null, lastModified: null, contentType: null, location: null }, body: Buffer.alloc(0) }
    const notModified = Boolean((req.etag && r.etag && req.etag === r.etag) || (req.lastModified && r.lastModified && req.lastModified === r.lastModified))
    return {
      url: req.url,
      status: notModified ? 304 : (r.status ?? 200),
      notModified,
      headers: { etag: r.etag ?? null, lastModified: r.lastModified ?? null, contentType: r.contentType ?? null, location: r.location ?? null },
      body: notModified || req.method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(r.body ?? ''),
    }
  }
}
