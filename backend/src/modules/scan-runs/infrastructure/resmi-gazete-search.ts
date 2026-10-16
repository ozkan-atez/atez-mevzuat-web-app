import { load } from 'cheerio'
import { AiProviderError, executeWithAiRetries } from '../../ai/domain/ai-errors'
import type { PreviousSourceSearch, PreviousSourceSearchCandidate } from '../application/ports'
import { containsExactIdentifier, normalizedTitle } from '../application/previous-source-matcher'
import type { SourcePolicy } from '../domain/source-policy'

interface Options {
  fetch?: typeof fetch
  timeoutMs: number
}

export class ResmiGazeteSearch implements PreviousSourceSearch {
  private readonly fetchFn: typeof fetch

  constructor(private readonly policy: SourcePolicy, options: Options) {
    this.fetchFn = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs
  }

  private readonly timeoutMs: number

  async search(input: { query: string; endDate: string; limit: number }): Promise<PreviousSourceSearchCandidate[]> {
    const endpoint = this.policy.assertAllowedUrl('https://www.resmigazete.gov.tr/Home/Filter')
    const payload = await this.read(endpoint.toString(), {
      method: 'POST',
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        'User-Agent': 'ATEZ-Mevzuat-Radari/1.0 (+official-source-search)',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: 'https://www.resmigazete.gov.tr/',
      },
      body: JSON.stringify({
        draw: 1,
        start: 0,
        length: Math.max(1, Math.min(input.limit, 20)),
        parameters: {
          searchtype: '1',
          genelaranacakkelime: input.query,
          genelbaslangictarihi: '',
          genelbitistarihi: input.endDate,
          genelsayi: '',
          genelmevzuatsayisi: '',
          genelmukerrer: '',
          genelmevzuatturu: '',
          genelkurumkodu: '',
        },
      }),
    }, response => response.json() as Promise<{ data?: unknown[] }>)
    return (payload.data ?? []).flatMap((raw) => mapCandidate(raw, input.query))
  }

  async resolveDocumentUrl(
    candidate: PreviousSourceSearchCandidate,
    intent: { targetRegulationIdentifier: string | null; targetRegulationTitle: string | null },
  ): Promise<string> {
    const candidateUrl = this.policy.assertAllowedUrl(candidate.url)
    const isArchiveIndex = /^\/eskiler\/\d{4}\/\d{2}\/\d{8}(?:M\d+)?\.htm$/i.test(candidateUrl.pathname)
    if (candidateUrl.pathname.toLowerCase() !== '/fihrist' && !isArchiveIndex) return candidateUrl.toString()

    const [year, month, day] = candidate.publicationDate.split('-')
    if (!year || !month || !day) throw new Error('Previous source candidate date is invalid')
    const mukerrerNumber = candidate.mukerrer?.match(/(?:EVET)?([0-9]+)/i)?.[1]
      ?? candidateUrl.searchParams.get('mukerrer')
    const suffix = mukerrerNumber ? `M${mukerrerNumber}` : ''
    const archiveUrl = isArchiveIndex ? candidateUrl : this.policy.assertAllowedUrl(`https://www.resmigazete.gov.tr/eskiler/${year}/${month}/${year}${month}${day}${suffix}.htm`)
    const html = await this.read(archiveUrl.toString(), {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { 'User-Agent': 'ATEZ-Mevzuat-Radari/1.0 (+official-source-search)' },
    }, async response => decodeHtml(Buffer.from(await response.arrayBuffer()), response.headers.get('content-type')))
    const $ = load(html)
    const matches = $('a[href]').toArray().flatMap((element) => {
      const href = $(element).attr('href')?.trim()
      if (!href) return []
      const text = $(element).text().replace(/\s+/g, ' ').trim()
      const identifierMatch = intent.targetRegulationIdentifier
        ? containsExactIdentifier(text, intent.targetRegulationIdentifier)
        : true
      const anchorTitle = normalizedTitle(text)
      const selectedTitle = normalizedTitle(candidate.title)
      // Older indexes group multiple numbered communiqués under one PDF.
      // Require the exact identifier AND the same title family, never number alone.
      const groupedMatch = Boolean(intent.targetRegulationIdentifier) && /tebliğler/iu.test(text)
        && titleFamily(text) === titleFamily(candidate.title)
      const titleMatch = Boolean(anchorTitle && selectedTitle) && (anchorTitle.includes(selectedTitle) || selectedTitle.includes(anchorTitle) || groupedMatch)
      if (!identifierMatch || !titleMatch) return []
      return [this.policy.assertAllowedUrl(new URL(href, archiveUrl).toString(), archiveUrl.toString()).toString()]
    })
    const unique = [...new Set(matches)]
    if (unique.length !== 1) throw new AiProviderError('INVALID_RESPONSE', false,
      unique.length === 0 ? `Önceki kaynak belge bağlantısı bulunamadı: ${archiveUrl}` : `Önceki kaynak belge bağlantısı belirsiz: ${archiveUrl}`)
    return unique[0]!
  }

  private async read<T>(url: string, init: RequestInit, decode: (response: Response) => Promise<T>): Promise<T> {
    return executeWithAiRetries(async () => {
      try {
        const response = await this.fetchFn(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) })
        if (!response.ok) throw new AiProviderError(response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
          response.status === 429 || response.status >= 500, `Resmî Gazete erişimi HTTP ${response.status}: ${url}`, response.status)
        return await decode(response)
      } catch (error) {
        if (error instanceof AiProviderError) throw error
        if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
          throw new AiProviderError('TIMEOUT', true, `Resmî Gazete erişimi zaman aşımına uğradı: ${url}`)
        if (error instanceof TypeError && error.message === 'fetch failed')
          throw new AiProviderError('PROVIDER_UNAVAILABLE', true, `Resmî Gazete bağlantısı kurulamadı: ${url}`)
        throw error
      }
    }, { maxAttempts: 3 })
  }

}

function mapCandidate(raw: unknown, query: string): PreviousSourceSearchCandidate[] {
  if (!raw || typeof raw !== 'object') return []
  const item = raw as Record<string, unknown>
  const title = typeof item.konu === 'string' ? item.konu.trim() : ''
  const formattedDate = typeof item.resmiGazeteTarihiFormatted === 'string' ? item.resmiGazeteTarihiFormatted : ''
  const dateMatch = formattedDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  const relativeUrl = typeof item.url === 'string' ? item.url : ''
  if (!title || !dateMatch || !relativeUrl) return []
  return [{
    query,
    title,
    publicationDate: `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`,
    gazetteNo: item.resmiGazeteSayisi === null || item.resmiGazeteSayisi === undefined ? null : String(item.resmiGazeteSayisi),
    mukerrer: typeof item.mukerrer === 'string' && item.mukerrer !== 'HAYIR' ? item.mukerrer : null,
    url: new URL(relativeUrl, 'https://www.resmigazete.gov.tr').toString(),
    regulationType: typeof item.mevzuatAdi === 'string' ? item.mevzuatAdi : null,
  }]
}

function decodeHtml(bytes: Buffer, contentType: string | null): string {
  const declared = contentType?.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase()
  const htmlHead = bytes.subarray(0, Math.min(bytes.length, 2_000)).toString('latin1')
  const embedded = htmlHead.match(/charset\s*=\s*["']?([^\s"';>]+)/i)?.[1]?.trim().toLowerCase()
  const charset = declared ?? embedded
  return new TextDecoder(charset === 'windows-1254' ? 'windows-1254' : 'utf-8').decode(bytes)
}

function titleFamily(value: string): string {
  return normalizedTitle(value.replace(/\([^)]*\)/g, ' ').replace(/tebliğler/giu, 'Tebliğ'))
    .replace(/\bde\b/g, '').replace(/\s+/g, ' ').trim()
}
