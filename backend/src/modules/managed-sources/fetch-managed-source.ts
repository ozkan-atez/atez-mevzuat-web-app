import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { isIP } from 'node:net'
import { load } from 'cheerio'
import { extractPdfText } from './pdf-text'

const MAX_BYTES = 4_000_000
const MAX_TEXT = 20_000

export interface FetchedManagedSource { contentText: string | null; contentType: string; fetchedAt: Date }

export function normalizeManagedSourceUrl(value: string): string {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('Geçerli bir HTTPS bağlantısı girin.') }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error('Yalnızca standart HTTPS bağlantıları eklenebilir.')
  }
  if (!url.hostname || url.hostname.length > 253 || /(?:^|\.)(?:localhost|local|internal)$/i.test(url.hostname)) {
    throw new Error('Yerel ağ bağlantıları eklenemez.')
  }
  const hostAddress = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostAddress) && !isPublicIp(hostAddress)) throw new Error('Yerel ağ bağlantıları eklenemez.')
  url.hash = ''
  return url.toString()
}

/** Pin each request to an already-validated public address, including redirects. */
async function publicAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const addresses = await lookup(hostname, { all: true })
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new Error('Bağlantı genel internete açık bir adrese yönlenmelidir.')
  }
  const selected = addresses.find(item => item.family === 4) ?? addresses[0]!
  return { address: selected.address, family: selected.family as 4 | 6 }
}

export function isPublicIp(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254
      || a === 100 && b! >= 64 && b! <= 127 || a === 172 && b! >= 16 && b! <= 31
      || a === 192 && (b === 0 || b === 168) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)
      || a === 203 && b === 0 && c === 113 || a === 255 || a! >= 224)
  }
  if (family === 6) {
    const lower = address.toLowerCase()
    // Public IPv6 unicast only; exclude documentation and tunnelling ranges.
    return /^[23][0-9a-f]/.test(lower) && !/^2001:(?:db8|0:|10:)/.test(lower) && !/^2002:/.test(lower)
  }
  return false
}

async function download(url: URL, redirects = 0, maxBytes = MAX_BYTES): Promise<{ body: Buffer; contentType: string; finalUrl: string }> {
  if (redirects > 3) throw new Error('Kaynak çok fazla yönlendirme yaptı.')
  const { address, family } = await publicAddress(url.hostname.replace(/^\[|\]$/g, ''))
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'GET', timeout: 12_000,
      lookup: (_host, lookupOptions, callback) => {
        if (typeof lookupOptions === 'object' && lookupOptions.all) callback(null, [{ address, family }])
        else callback(null, address, family)
      },
      headers: { 'User-Agent': 'ATEZ-Mevzuat-Radari/1.0', Accept: 'text/html,application/pdf,image/*;q=0.9,*/*;q=0.8' },
    }, (response) => {
      const status = response.statusCode ?? 0
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location
        response.resume()
        if (!location) { reject(new Error('Yönlendirme adresi eksik.')); return }
        let next: URL
        try { next = new URL(normalizeManagedSourceUrl(new URL(location, url).toString())) }
        catch (error) { reject(error); return }
        void download(next, redirects + 1, maxBytes).then(resolve, reject)
        return
      }
      if (status < 200 || status >= 300) { response.resume(); reject(new Error(`Kaynak HTTP ${status} döndürdü.`)); return }
      if (Number(response.headers['content-length'] ?? 0) > maxBytes) {
        response.destroy(); reject(new Error('Kaynak dosyası boyut sınırını aşıyor.')); return
      }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > maxBytes) { response.destroy(new Error('Kaynak dosyası boyut sınırını aşıyor.')); return }
        chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => resolve({ body: Buffer.concat(chunks), contentType: String(response.headers['content-type'] ?? ''), finalUrl: url.toString() }))
    })
    req.on('timeout', () => req.destroy(new Error('Kaynak bağlantısı zaman aşımına uğradı.')))
    req.on('error', reject)
    req.end()
  })
}

export async function fetchManagedSource(value: string): Promise<FetchedManagedSource> {
  const url = new URL(normalizeManagedSourceUrl(value))
  const { body, contentType } = await download(url)
  const pdf = contentType.toLowerCase().includes('application/pdf') || body.subarray(0, 5).toString() === '%PDF-'
  if (pdf) {
    let contentText: string | null = null
    try { contentText = (await extractPdfText(body))?.slice(0, MAX_TEXT) || null } catch { /* unreadable PDF */ }
    return { contentText, contentType: 'application/pdf', fetchedAt: new Date() }
  }
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error('Yalnızca HTML veya PDF kaynakları okunabilir.')
  const head = body.subarray(0, Math.min(body.length, 2_000)).toString('latin1')
  const decoded = new TextDecoder(/charset\s*=\s*["']?windows-1254/i.test(head) ? 'windows-1254' : 'utf-8').decode(body)
  const $ = load(decoded)
  $('script, style, nav, header, footer, aside, noscript').remove()
  $('br, p, li, tr').each((_index, node) => { $(node).append('\n') })
  const contentText = $('body').text().replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT) || null
  return { contentText, contentType: 'text/html', fetchedAt: new Date() }
}

/** Only same-host links from one bounded public HTML page are considered for discovery. */
export async function fetchSourceLinks(value: string): Promise<Array<{ url: string; title: string }>> {
  const root = new URL(normalizeManagedSourceUrl(value))
  const { body, contentType } = await download(root)
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error('Keşif için HTML sayfası gereklidir.')
  }
  const $ = load(body.toString('utf8'))
  const links = new Map<string, string>()
  $('a[href]').each((_index, element) => {
    if (links.size >= 120) return
    const href = $(element).attr('href')
    const title = $(element).text().replace(/\s+/g, ' ').trim().slice(0, 200)
    if (!href || title.length < 4) return
    try {
      const url = new URL(normalizeManagedSourceUrl(new URL(href, root).toString()))
      if (url.hostname !== root.hostname || url.toString() === root.toString() || url.toString().length > 1_000) return
      if (/\.(?:jpg|jpeg|png|gif|svg|webp|zip|docx?|xlsx?)$/i.test(url.pathname)) return
      links.set(url.toString(), title)
    } catch { /* skip non-HTTPS and malformed links */ }
  })
  return [...links].map(([url, title]) => ({ url, title }))
}

export async function fetchSourceHtml(value: string): Promise<string> {
  const { body, contentType } = await download(new URL(normalizeManagedSourceUrl(value)))
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error('Kaynak HTML sayfası döndürmedi.')
  const head = body.subarray(0, Math.min(body.length, 2_000)).toString('latin1')
  const charset = /charset\s*=\s*["']?windows-1254/i.test(`${contentType} ${head}`) ? 'windows-1254' : 'utf-8'
  return new TextDecoder(charset).decode(body)
}

/** Public-network and redirect checks also apply to original documents and attachments. */
export async function fetchSourceBinary(value: string, maxBytes = 25_000_000): Promise<{ body: Buffer; contentType: string; finalUrl: string }> {
  return download(new URL(normalizeManagedSourceUrl(value)), 0, maxBytes)
}
