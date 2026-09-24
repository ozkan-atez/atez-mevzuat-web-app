import { load } from 'cheerio'
import { fetchManagedSource, fetchSourceHtml, normalizeManagedSourceUrl } from './fetch-managed-source'
import { clearTariffToken, getTariffAccessToken, type TariffCredentials } from './tariff-auth'

export interface SourceFeedItem { title: string; url: string; publishedOn: string; feedUrl: string }
const months: Record<string, number> = { ocak: 1, şubat: 2, mart: 3, nisan: 4, mayıs: 5, haziran: 6, temmuz: 7, ağustos: 8, eylül: 9, ekim: 10, kasım: 11, aralık: 12 }

export function parseTurkishDate(value: string): string | null {
  const numeric = value.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/)
  const textual = value.toLocaleLowerCase('tr-TR').match(/\b(\d{1,2})\s+(ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)\s+(\d{4})\b/)
  const day = Number(numeric?.[1] ?? textual?.[1])
  const month = Number(numeric?.[2] ?? (textual ? months[textual[2]!] : NaN))
  const year = Number(numeric?.[3] ?? textual?.[3])
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10) : null
}

function safeLink(href: string | undefined, base: string, sourceKey: string): string | null {
  if (!href) return null
  try {
    const url = new URL(normalizeManagedSourceUrl(new URL(href, base).toString()))
    const host = url.hostname.toLowerCase()
    const allowed = sourceKey === 'ticaret-bakanligi' ? host === 'ticaret.gov.tr' || host.endsWith('.ticaret.gov.tr')
      : sourceKey === 'igmd' ? host === 'igmd.org.tr' || host.endsWith('.igmd.org.tr')
        : sourceKey === 'mevzuat-net' ? host === 'mevzuat.net' || host === 'www.mevzuat.net'
          : host === new URL(base).hostname
    return allowed ? url.toString() : null
  } catch { return null }
}

export function parseDatedFeed(adapter: string, html: string, feedUrl: string, targetDate: string, sourceKey: string): SourceFeedItem[] {
  const $ = load(html)
  const items: SourceFeedItem[] = []
  const push = (href: string | undefined, title: string, dateText: string) => {
    const publishedOn = parseTurkishDate(dateText)
    const url = safeLink(href, feedUrl, sourceKey)
    if (publishedOn === targetDate && url && title.trim()) items.push({ url, title: title.trim().replace(/\s+/g, ' ').slice(0, 300), publishedOn, feedUrl })
  }
  if (adapter === 'IGMD_MEVZUAT') {
    $('h4.haberbaslik a[href]').each((_index, link) => {
      const card = $(link).closest('.border-ec')
      push($(link).attr('href'), $(link).text(), card.find('.bilgiler').text())
    })
  } else if (adapter === 'MEVZUAT_GUNCELLIK') {
    $('table tr').each((_index, row) => {
      const cells = $(row).find('td')
      const link = cells.eq(3).find('a[href]').first()
      push(link.attr('href'), link.text(), cells.eq(1).text())
    })
  } else if (adapter === 'TICARET_GENELGE') {
    $('table tr').each((_index, row) => {
      const cells = $(row).find('td')
      const link = $(row).find('a[href$=".pdf"],a[href$=".PDF"]').first()
      push(link.attr('href'), cells.eq(0).text(), cells.eq(2).text())
    })
  } else if (adapter === 'GENERIC') {
    $('article, li, tr').slice(0, 100).each((_index, row) => {
      const link = $(row).find('a[href]').first()
      push(link.attr('href'), link.text(), $(row).text().slice(0, 400))
    })
  }
  return [...new Map(items.map((item) => [item.url, item])).values()].slice(0, 50)
}

export async function scrapeSourceFeed(input: { adapter: string; url: string; sourceKey: string; targetDate: string; credentials?: TariffCredentials }): Promise<SourceFeedItem[]> {
  const feedUrl = input.adapter === 'TICARET_GENELGE' ? input.url.replace(/\/\d{4}\/?$/, `/${input.targetDate.slice(0, 4)}`) : input.url
  if (input.adapter === 'TARIFF_API') return scrapeTariff(input.targetDate, input.credentials, input.url)
  const html = await fetchSourceHtml(feedUrl)
  if (input.adapter !== 'TICARET_DUYURULAR') {
    const items = parseDatedFeed(input.adapter, html, feedUrl, input.targetDate, input.sourceKey)
    const $ = load(html)
    const selector = input.adapter === 'IGMD_MEVZUAT' ? '.border-ec .bilgiler' : input.adapter === 'MEVZUAT_GUNCELLIK' ? 'table tr td:nth-child(2)' : 'table tr td:nth-child(3)'
    const visibleDates = $(selector).map((_index, node) => parseTurkishDate($(node).text())).get().filter((date): date is string => Boolean(date))
    if (!visibleDates.length) throw new Error('Kaynak listesinin tarih alanları okunamadı; sonuç doğrulanamadı.')
    if (input.targetDate < visibleDates.sort()[0]!) throw new Error(`Bu liste yalnızca ${visibleDates[0]} ve sonrasını kapsıyor; eski tarih doğrulanamadı.`)
    return items
  }
  const $ = load(html)
  const links = new Map<string, string>()
  $('ul.dizin-content li a[href]').slice(0, 35).each((_index, link) => {
    const url = safeLink($(link).attr('href'), feedUrl, input.sourceKey)
    if (url) links.set(url, $(link).text().trim())
  })
  const items: SourceFeedItem[] = []
  const visibleDates: string[] = []
  for (const [url, title] of links) {
    try {
      const detail = load(await fetchSourceHtml(url))
      const publishedOn = parseTurkishDate(detail('.__header span').first().text())
      if (publishedOn) visibleDates.push(publishedOn)
      if (publishedOn === input.targetDate) items.push({ url, title, publishedOn, feedUrl })
    } catch { /* A missing detail does not erase successfully read notices. */ }
  }
  if (!visibleDates.length) throw new Error('Duyuru ayrıntılarının tarihleri okunamadı; sonuç doğrulanamadı.')
  if (input.targetDate < visibleDates.sort()[0]!) throw new Error(`Duyuru listesi yalnızca ${visibleDates[0]} ve sonrasını kapsıyor; eski tarih doğrulanamadı.`)
  return items
}

async function scrapeTariff(targetDate: string, credentials: TariffCredentials | undefined, feedUrl: string): Promise<SourceFeedItem[]> {
  if (!credentials) throw new Error('TARIFF kullanıcı hesabı yapılandırılmamış veya etkin değil.')
  const url = `https://tariff.singlewindow.io/api/v2-0/tariff-query/notification-details/all/?start_date=${targetDate}`
  const request = async () => fetch(url, { headers: { Authorization: `Bearer ${await getTariffAccessToken(credentials)}` }, redirect: 'error', signal: AbortSignal.timeout(12_000) })
  let response = await request()
  if (response.status === 401) { clearTariffToken(); response = await request() }
  if (!response.ok) throw new Error(`TARIFF duyuru erişimi başarısız (${response.status}).`)
  if (Number(response.headers.get('content-length') ?? 0) > 4_000_000) throw new Error('TARIFF yanıtı boyut sınırını aşıyor.')
  const body = await response.text()
  if (body.length > 4_000_000) throw new Error('TARIFF yanıtı boyut sınırını aşıyor.')
  const value: unknown = JSON.parse(body)
  const rows = Array.isArray(value) ? value : value && typeof value === 'object' && 'data' in value && Array.isArray(value.data) ? value.data : []
  return rows.flatMap((row: Record<string, unknown>) => {
    const date = typeof row.created_at === 'string' ? row.created_at.slice(0, 10) : ''
    const code = String(row.event_code ?? '')
    const message = Array.isArray(row.notification_messages) ? row.notification_messages[0] as Record<string, unknown> | undefined : undefined
    const title = String(message?.title ?? row.title ?? '').slice(0, 300)
    if (date !== targetDate || !code || !title) return []
    return [{ title, url: `${feedUrl}?eventCode=${encodeURIComponent(code)}`, publishedOn: date, feedUrl }]
  }).slice(0, 50)
}

export async function readSourceItem(item: SourceFeedItem, adapter: string): Promise<string | null> {
  if (adapter === 'TARIFF_API') return null // Protected details need the provider's authenticated API.
  return (await fetchManagedSource(item.url)).contentText
}
