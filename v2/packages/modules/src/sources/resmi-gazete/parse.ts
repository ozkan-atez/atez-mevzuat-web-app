import { load, type CheerioAPI } from 'cheerio'

/**
 * Resmî Gazete günlük sayfa ve mükerrer fihrist ayrıştırıcısı (§9.1 karnesi; dalın
 * `gazette-prototype/parsing.ts` mantığından taşındı).
 */
export const RG_HOSTS = ['www.resmigazete.gov.tr', 'resmigazete.gov.tr'] as const
export const RG_BASE = 'https://www.resmigazete.gov.tr'

const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']

export interface RgListItem {
  url: string
  /** `rg:` + URL yolu; RG belge URL'leri kalıcıdır. */
  canonicalKey: string
  title: string
  kind: 'REGULATION' | 'ANNOUNCEMENT'
  rgSection: string | null
  rgType: string | null
  mukerrer: number | null
  position: number
}

export interface RgDayPage {
  date: string
  issue: string
  items: RgListItem[]
  /** `#sonMukerrerContainer` kuralıyla bulunan, o güne ait mükerrer fihristleri. */
  mukerrer: { n: number; url: string }[]
  badgeCount: number
}

export interface RgFihristPage {
  date: string
  issue: string
  mukerrer: number
  items: RgListItem[]
}

export const clean = (s: string) => s.replace(/[\u2002-\u200b\u00a0]/g, ' ').replace(/\s+/g, ' ').trim()
/** Fihrist başlıklarındaki "–– " / "– " ön ekini kaldırır. */
const stripDash = (s: string) => s.replace(/^[–—-]+\s*/, '')

export function dayPageUrl(date: string): string {
  const [y, m, d] = date.split('-')
  return `${RG_BASE}/${d}.${m}.${y}`
}
export const fihristUrl = (date: string, n: number) => `${RG_BASE}/fihrist?tarih=${date}&mukerrer=${n}`

export function turkishDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${d} ${TR_MONTHS[m! - 1]} ${y}`
}

export function canonicalKeyFor(url: string): string {
  const u = new URL(url)
  return `rg:${u.pathname.replace(/^\//, '')}`
}

function officialUrl(href: string): string | null {
  let u: URL
  try {
    u = new URL(href, RG_BASE)
  } catch {
    return null
  }
  if (!(RG_HOSTS as readonly string[]).includes(u.hostname)) return null
  u.protocol = 'https:'
  u.hostname = 'www.resmigazete.gov.tr'
  u.hash = ''
  return u.toString()
}

/** Başlıktaki "31 Aralık 2025 Tarihli ve 33124 Sayılı Resmî Gazete" kimliğini doğrular. */
function readIssue($: CheerioAPI, date: string, where: string): string {
  const header = clean($('#spanGazeteTarih').text()) || clean($('.preview-title').first().text())
  const expected = turkishDate(date)
  const m = header.match(/(\d{1,2} \S+ \d{4}) Tarihli ve (\d{4,6}) Sayılı/i)
  const norm = (v: string) => v.replace(/^0/, '').toLocaleLowerCase('tr')
  if (!m || norm(m[1]!) !== norm(expected)) {
    throw new RgParseError(`RG ${where}: sayfa ${date} gününe ait değil (başlık: "${header.slice(0, 120)}")`, 'RG_DATE_MISMATCH')
  }
  return m[2]!
}

export class RgParseError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
  }
}

function parseItems($: CheerioAPI, date: string, mukerrer: number | null): RgListItem[] {
  const stem = date.replace(/-/g, '')
  const docPath = new RegExp(`/${stem}(?:M\\d+)?-\\d+(?:-\\d+)?\\.(?:html?|pdf)$`, 'i')
  const items = new Map<string, RgListItem>()
  let section: string | null = null
  let type: string | null = null
  $('#html-content')
    .children()
    .each((_, el) => {
      const node = $(el)
      if (node.hasClass('html-title')) {
        section = clean(node.text())
        type = null
        return
      }
      if (node.hasClass('html-subtitle')) {
        type = clean(node.text())
        return
      }
      if (!node.hasClass('fihrist-item')) return
      const a = node.find('a[href]').first()
      const url = officialUrl(a.attr('href') ?? '')
      if (!url) return
      const path = new URL(url).pathname
      // Günlük sayfadaki "…mükerrer sayılı Resmî Gazete'de…" çapraz bağlantıları belge değildir.
      if (!docPath.test(path)) return
      if (items.has(url)) return
      const isAnnouncement = path.includes('/ilanlar/')
      items.set(url, {
        url,
        canonicalKey: canonicalKeyFor(url),
        title: stripDash(clean(a.text())),
        kind: isAnnouncement ? 'ANNOUNCEMENT' : 'REGULATION',
        rgSection: section,
        rgType: isAnnouncement ? null : type,
        mukerrer,
        position: items.size,
      })
    })
  return [...items.values()]
}

/**
 * Günlük sayfa. Mükerrer kuralı (§9.1 karar 1):
 *  - `#sonMukerrerContainer` yoksa mükerrer yok;
 *  - tek mükerrer: `a#sonMukerrerBtn` (href = o günün fihristi, `.badge` = 1);
 *  - 2+ mükerrer: `#sonMukerrerList a.dropdown-item` (her biri sabit URL), rozette toplam.
 * Üst menüdeki güne özgü olmayan "Son Mükerrer" bağlantısı kullanılmaz.
 */
export function parseDayPage(html: string, date: string): RgDayPage {
  const $ = load(html)
  const issue = readIssue($, date, 'günlük sayfa')
  const container = $('#sonMukerrerContainer')
  const links = new Map<number, string>()
  let badgeCount = 0
  if (container.length) {
    badgeCount = Number(clean(container.find('.badge').first().text())) || 0
    const anchors = container.find('a#sonMukerrerBtn, #sonMukerrerList a.dropdown-item')
    anchors.each((_, a) => {
      const url = officialUrl($(a).attr('href') ?? '')
      if (!url) return
      const u = new URL(url)
      const n = Number(u.searchParams.get('mukerrer'))
      if (u.pathname === '/fihrist' && u.searchParams.get('tarih') === date && Number.isInteger(n) && n > 0) links.set(n, url)
    })
    if (badgeCount && links.size !== badgeCount) {
      throw new RgParseError(`Mükerrer rozeti (${badgeCount}) ile bağlantı sayısı (${links.size}) uyuşmuyor`, 'RG_MUKERRER_MISMATCH')
    }
  }
  const items = parseItems($, date, null)
  if (items.length === 0) throw new RgParseError('Günlük fihrist boş veya yapı değişmiş', 'RG_EMPTY_INDEX')
  return {
    date,
    issue,
    items,
    mukerrer: [...links.entries()].sort(([a], [b]) => a - b).map(([n, url]) => ({ n, url })),
    badgeCount: badgeCount || links.size,
  }
}

export function parseFihristPage(html: string, date: string, mukerrer: number): RgFihristPage {
  const $ = load(html)
  const issue = readIssue($, date, `${mukerrer}. mükerrer`)
  const items = parseItems($, date, mukerrer)
  if (items.length === 0) throw new RgParseError(`${mukerrer}. mükerrer fihristi boş`, 'RG_EMPTY_INDEX')
  return { date, issue, mukerrer, items }
}
