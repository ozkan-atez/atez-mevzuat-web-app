import { load } from 'cheerio'
import { fetchManagedSource, fetchSourceHtml, normalizeManagedSourceUrl } from './fetch-managed-source'
import { clearTariffToken, getTariffAccessToken, type TariffCredentials } from './tariff-auth'

export interface SourceFeedItem { title: string; url: string; publishedOn: string; feedUrl: string; capturedContent?: string | null; capturedHtml?: string; attachments?: Array<{ url: string; title: string }> }
const months: Record<string, number> = { ocak: 1, şubat: 2, mart: 3, nisan: 4, mayıs: 5, haziran: 6, temmuz: 7, ağustos: 8, eylül: 9, ekim: 10, kasım: 11, aralık: 12 }

export function parseTurkishDate(value: string): string | null {
  const numeric = value.match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-]+(\d{4})\b/)
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
    const baseHost = new URL(base).hostname.replace(/^www\./,'')
    const targetHost = host.replace(/^www\./,'')
    const allowed = sourceKey === 'ticaret-bakanligi' || baseHost === 'ticaret.gov.tr' || baseHost.endsWith('.ticaret.gov.tr') ? host === 'ticaret.gov.tr' || host.endsWith('.ticaret.gov.tr')
      : sourceKey === 'igmd' ? host === 'igmd.org.tr' || host.endsWith('.igmd.org.tr')
        : sourceKey === 'mevzuat-net' ? host === 'mevzuat.net' || host === 'www.mevzuat.net'
          : targetHost === baseHost || targetHost.endsWith(`.${baseHost}`)
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
      const links = $(row).find('a[href]').filter((_i, link) => { try { return /\.pdf$/i.test(new URL($(link).attr('href')!, feedUrl).pathname) } catch { return false } })
      const link = links.first()
      const before = items.length
      push(link.attr('href'), cells.eq(0).text(), cells.eq(2).text())
      if (items.length > before) items[items.length - 1]!.attachments = $(row).find('a[href]').toArray().flatMap(anchor => { const url = safeLink($(anchor).attr('href'), feedUrl, sourceKey); return url && url !== items[items.length - 1]!.url ? [{ url, title: $(anchor).text().trim() }] : [] })
    })
  } else if (adapter === 'GENERIC') {
    $('article, li, tr').each((_index, row) => {
      const link = $(row).find('a[href]').first()
      const rawDate = $(row).find('time[datetime]').attr('datetime')
      const published = rawDate && /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? rawDate.slice(0,10).split('-').reverse().join('.') : $(row).text().slice(0, 800)
      push(link.attr('href'), link.text(), published)
    })
  }
  const unique = [...new Map(items.map((item) => [item.url, item])).values()]
  if (unique.length > 50) throw new Error('Bu tarihte 50 belgeden fazla kayıt var; liste eksiksiz taranamadı.')
  return unique
}

export async function scrapeSourceFeed(input: { adapter: string; url: string; sourceKey: string; targetDate: string; credentials?: TariffCredentials; datePolicy?: string; maxPages?: number; maxDocuments?: number }): Promise<SourceFeedItem[] & {coverageWarnings?:string[]}> {
  const feedUrl = input.adapter === 'TICARET_GENELGE' ? input.url.replace(/\/\d{4}\/?$/, `/${input.targetDate.slice(0, 4)}`) : input.url
  if (input.adapter === 'TARIFF_API') return scrapeTariff(input.targetDate, input.credentials, input.url, input.datePolicy, input.maxPages, input.maxDocuments)
  const html = await fetchSourceHtml(feedUrl)
  if (input.adapter !== 'TICARET_DUYURULAR') {
    const items = parseDatedFeed(input.adapter, html, feedUrl, input.targetDate, input.sourceKey)
    const $ = load(html)
    const selector = input.adapter === 'GENERIC' ? 'article,li,tr,time' : input.adapter === 'IGMD_MEVZUAT' ? '.border-ec .bilgiler' : input.adapter === 'MEVZUAT_GUNCELLIK' ? 'table tr td:nth-child(2)' : 'table tr td:nth-child(3)'
    const visibleDates = $(selector).map((_index, node) => parseTurkishDate($(node).attr('datetime')?.slice(0,10).split('-').reverse().join('.') ?? $(node).text())).get().filter((date): date is string => Boolean(date))
    if (!visibleDates.length) throw new Error('Kaynak listesinin tarih alanları okunamadı; sonuç doğrulanamadı.')
    if (input.targetDate < visibleDates.sort()[0]!) throw new Error(`Bu liste yalnızca ${visibleDates[0]} ve sonrasını kapsıyor; eski tarih doğrulanamadı.`)
    return items
  }
  const $ = load(html)
  const links = new Map<string, { title: string; date: string | null }>()
  $('ul.dizin-content li a[href]').each((_index, link) => {
    const url = safeLink($(link).attr('href'), feedUrl, input.sourceKey)
    if (url) links.set(url, { title: $(link).text().trim(), date: parseTurkishDate($(link).closest('li').find('time, span, p').map((_i, node) => $(node).text()).get().join(' ')) })
  })
  const items: SourceFeedItem[] = []
  const visibleDates: string[] = []
  const candidates = [...links]
  const warnings: string[] = []
  if(candidates.length > 80) warnings.push('80 duyuru sınırı aşıldı; liste eksiksiz doğrulanamadı.')
  for(let start=0;start<Math.min(candidates.length,80);start+=3) {
    await Promise.all(candidates.slice(start,Math.min(start+3,80)).map(async ([url,{title,date}])=>{
      // Some announcements link directly to files, without an HTML detail page.
      // Only an explicit date on the listing can place such a file in a daily scan.
      if (/\.(pdf|docx?|xlsx?|zip)$/i.test(new URL(url).pathname)) {
        if (date) {
          visibleDates.push(date)
          if (date === input.targetDate) items.push({ url, title, publishedOn: date, feedUrl })
        } else warnings.push(`Yayın tarihi belirtilmeyen dosya günlük taramaya alınamadı: ${title}`)
        return
      }
      try {
        const detail=load(await fetchSourceHtml(url))
        const publishedOn=parseTurkishDate(detail('.__header span').first().text())
        if(publishedOn) visibleDates.push(publishedOn)
        else warnings.push(`Duyuru tarihi okunamadı: ${title}`)
        if(publishedOn===input.targetDate) items.push({url,title,publishedOn,feedUrl})
      } catch (error) { warnings.push(`Duyuru ayrıntısı okunamadı: ${title} — ${error instanceof Error ? error.message : 'Erişim hatası'}`) }
    }))
    if(start+3<Math.min(candidates.length,80)) await new Promise(resolve=>setTimeout(resolve,750))
  }
  if (!visibleDates.length) throw new Error('Duyuru ayrıntılarının tarihleri okunamadı; sonuç doğrulanamadı.')
  if (input.targetDate < visibleDates.sort()[0]!) throw new Error(`Duyuru listesi yalnızca ${visibleDates[0]} ve sonrasını kapsıyor; eski tarih doğrulanamadı.`)
  if(warnings.length) Object.defineProperty(items,'coverageWarnings',{value:warnings,enumerable:false})
  return items
}

async function scrapeTariff(targetDate: string, credentials: TariffCredentials | undefined, feedUrl: string, datePolicy='PUBLISHED_DATE', maxPages=20, maxDocuments=100): Promise<SourceFeedItem[] & {coverageWarnings?:string[]}> {
  if (!credentials) throw new Error('TARIFF kullanıcı hesabı yapılandırılmamış veya etkin değil.')
  const endpoint = new URL('https://tariff.singlewindow.io/api/v2-0/tariff-query/notification-details/all/')
  if(datePolicy==='PUBLISHED_DATE')endpoint.searchParams.set('start_date', targetDate)
  const coverageWarnings:string[]=[]
  endpoint.searchParams.set('pageSize', '100')
  const readPage = async (page: number): Promise<unknown> => {
    const url = new URL(endpoint); url.searchParams.set('page', String(page))
    const request = async () => fetch(url.toString(), { headers: { Authorization: `Bearer ${await getTariffAccessToken(credentials)}` }, redirect: 'error', signal: AbortSignal.timeout(12_000) })
    let response = await request()
    if (response.status === 401) { clearTariffToken(); response = await request() }
    if (!response.ok) throw new Error(`TARIFF duyuru erişimi başarısız (${response.status}).`)
    if (Number(response.headers.get('content-length') ?? 0) > 4_000_000) throw new Error('TARIFF yanıtı boyut sınırını aşıyor.')
    const body = await response.text()
    if (Buffer.byteLength(body, 'utf8') > 4_000_000) throw new Error('TARIFF yanıtı boyut sınırını aşıyor.')
    return JSON.parse(body) as unknown
  }
  const extractRows = (value: unknown): unknown[] => {
    const rows = Array.isArray(value) ? value : value && typeof value === 'object'
      ? ['records', 'data'].map(key => Reflect.get(value, key)).find(Array.isArray) : null
    if (!Array.isArray(rows)) throw new Error('TARIFF duyuru yanıtı beklenen kayıt biçiminde değil.')
    return rows
  }
  const first = await readPage(1)
  const rows = extractRows(first)
  if (first && typeof first === 'object' && !Array.isArray(first) && 'records' in first && 'total' in first) {
    const total = Number(Reflect.get(first, 'total'))
    const pageSize = Number(Reflect.get(first, 'pageSize'))
    if (!Number.isInteger(total) || total < 0 || !Number.isInteger(pageSize) || pageSize < 1) throw new Error('TARIFF sayfalama bilgisi doğrulanamadı.')
    const pages = Math.ceil(total / pageSize)
    if(pages>maxPages)coverageWarnings.push('TARIFF sayfa sınırına ulaşıldı; tarama kapsamı eksik.')
    for (let page = 2; page <= Math.min(pages,maxPages); page++) {
      const next = await readPage(page)
      if (!next || typeof next !== 'object' || Number(Reflect.get(next, 'page')) !== page) throw new Error('TARIFF duyuru sayfası doğrulanamadı.')
      rows.push(...extractRows(next))
    }
    if (pages<=maxPages && rows.length < total) throw new Error('TARIFF duyuru listesi eksik döndü; sonuç doğrulanamadı.')
  }
  const items=rows.flatMap((raw): SourceFeedItem[] => {
    if (!raw || typeof raw !== 'object') return []
    const row = raw as Record<string, unknown>
    const date = typeof row.created_at === 'string' ? row.created_at.slice(0, 10) : ''
    const code = typeof row.event_code === 'string' || typeof row.event_code === 'number' ? String(row.event_code) : ''
    const messages = Array.isArray(row.notification_messages) ? row.notification_messages.filter((message): message is Record<string, unknown> => Boolean(message && typeof message === 'object')) : []
    const ordered = [...messages].sort((left, right) => Number(String(right.language_code).toLowerCase() === 'tr') - Number(String(left.language_code).toLowerCase() === 'tr'))
    const message = ordered.find(message => typeof message.formatted_text === 'string' && message.formatted_text.trim()) ?? ordered[0]
    const title = typeof message?.title === 'string' ? message.title.slice(0, 300) : typeof row.title === 'string' ? row.title.slice(0, 300) : ''
    if ((datePolicy==='PUBLISHED_DATE'&&date !== targetDate) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !code || !title) return []
    const itemUrl = new URL(feedUrl)
    itemUrl.searchParams.set('eventCode', code)
    const capturedContent = tariffMessageContent(message, title, itemUrl.toString())
    return [{ title, url: itemUrl.toString(), publishedOn: date, feedUrl, capturedContent, ...(typeof message?.formatted_text === 'string' ? {capturedHtml:message.formatted_text.slice(0,300000)} : {}) }]
  })
  if(items.length>maxDocuments)coverageWarnings.push('TARIFF belge sınırına ulaşıldı; tarama kapsamı eksik.')
  return Object.assign(items.slice(0,maxDocuments),{coverageWarnings})
}

/** Only the authenticated notification's actual body is evidence. Account/payload metadata is excluded. */
function tariffMessageContent(message: Record<string, unknown> | undefined, title: string, url: string): string | null {
  if (typeof message?.formatted_text !== 'string' || !message.formatted_text.trim()) return null
  const $ = load(message.formatted_text.slice(0, 300_000))
  $('script,style,template,noscript').remove()
  $('br').replaceWith('\n')
  $('p,div,tr,li,h1,h2,h3').append('\n')
  const text = $('body').text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim()
  if (!text || text.replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR') === title.replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR')) return null
  const references = new Set<string>()
  $('a[href]').each((_index, link) => {
    try { const reference = new URL($(link).attr('href')!, url); if (['https:', 'http:'].includes(reference.protocol) && !reference.username && !reference.password) references.add(reference.toString()) } catch { /* Ignore non-document links. */ }
  })
  return `Kaynak: TARIFF\nBildirim bağlantısı: ${url}\n\n${text.slice(0, 80_000)}${references.size ? `\n\nBildirimdeki kaynak bağlantıları:\n${[...references].slice(0, 30).join('\n')}` : ''}`
}

export async function readSourceItem(item: SourceFeedItem, adapter: string, credentials?: TariffCredentials | null): Promise<string | null> {
  if (adapter === 'TARIFF_API') {
    if (item.capturedContent?.trim()) return item.capturedContent
    // Older queued records may lack the body. Reacquire from the known authenticated API.
    if (item.capturedContent === undefined && credentials) {
      const found = (await scrapeTariff(item.publishedOn, credentials, item.feedUrl)).find(candidate => candidate.url === item.url)
      if (found?.capturedContent) return found.capturedContent
    }
    throw new Error('TARIFF bildiriminde okunabilir içerik bulunamadı; yalnızca başlıktan rapor oluşturulamaz.')
  }
  return (await fetchManagedSource(item.url)).contentText
}
