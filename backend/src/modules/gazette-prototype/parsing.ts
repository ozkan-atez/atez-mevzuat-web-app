import { createHash } from 'node:crypto'
import { load } from 'cheerio'
import { DateTime } from 'luxon'
import { cleanText, type Entry, type Index } from './contracts'

export const identity = (url: string) => createHash('sha256').update(url).digest('hex').slice(0, 16)
export function officialUrl(value: string, base: string): string {
  let url = new URL(value, base)
  if (url.pathname.toLowerCase() === '/main.aspx' && url.searchParams.has('main')) url = new URL(url.searchParams.get('main')!, base)
  if (!['resmigazete.gov.tr','www.resmigazete.gov.tr'].includes(url.hostname)) throw new Error('Resmî Gazete dışındaki adres kapsam dışı.')
  if (url.protocol === 'http:') url.protocol = 'https:'
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Geçersiz kaynak adresi.')
  url.hash = ''
  return url.toString()
}
export function parseIndex(html: string, url: string, date: string): Index {
  const day = DateTime.fromISO(date, { zone: 'Europe/Istanbul' })
  if (!day.isValid || day.toISODate() !== date) throw new Error('Geçersiz hedef tarih.')
  const $ = load(html), text = cleanText($('body').text())
  const issueNumber = text.match(/(?:Sayı\s*:\s*(\d{4,6})|(\d{4,6})\s+Say[ıi]l[ıi])/i)?.slice(1).find(Boolean)
  const display = day.setLocale('tr').toFormat('d MMMM yyyy')
  if (!issueNumber || !text.toLocaleLowerCase('tr').includes(display.toLocaleLowerCase('tr'))) throw new Error('Fihristin tarih/sayı kimliği doğrulanamadı.')
  const stem = day.toFormat('yyyyMMdd'), entries = new Map<string, Entry>(), supplements = new Set<string>()
  $('a[href]').each((_, a) => {
    try {
      const target = officialUrl($(a).attr('href')!, url), u = new URL(target), title = cleanText($(a).text())
      // Global "Son Mükerrer" buttons can point to another day. Only the day's own
      // numbered edition links are discovery evidence, even if the global link matches.
      if (/^son\s+mükerrer/i.test(title)) return
      if (u.searchParams.get('tarih') === date && /^[1-9]\d*$/.test(u.searchParams.get('mukerrer')??'')) supplements.add(target)
      if (new RegExp(`/${stem}M\\d+\\.htm$`, 'i').test(u.pathname)) supplements.add(target)
      if (!new RegExp(`/${stem}(?:M\\d+)?-\\d+(?:-\\d+)?\\.(?:html?|pdf)$`, 'i').test(u.pathname)) return
      const item=$(a).closest('.fihrist-item'), documentType=u.pathname.includes('/ilanlar/')?'İLAN':cleanText(item.prevAll('.html-subtitle').first().text()), section=cleanText(item.prevAll('.html-title').first().text())
      entries.set(target, {id: identity(target), title, url: target, kind: u.pathname.includes('/ilanlar/') ? 'ANNOUNCEMENT' : 'REGULATION', parentUrl: url,...(documentType?{documentType}:{}),...(section?{section}:{})})
    } catch { /* External navigation is not an issue item. */ }
  })
  if (!entries.size) throw new Error('Fihrist boş veya belge bağlantı yapısı değişmiş.')
  return {url, date, issueNumber, entries:[...entries.values()], supplementUrls:[...supplements], text}
}
export function announcementLinks(html: string, entry: Entry): Entry[] {
  const $ = load(html), result = new Map<string, Entry>()
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href')!
    if (!/\.(pdf|htm|html)(?:[?#]|$)/i.test(href)) return
    const target = officialUrl(href, entry.url)
    if (target === entry.url) return
    const p = $(a).closest('p'), previous = p.prevAll('p').filter((_, el) => Boolean(cleanText($(el).text()))).first()
    const before = cleanText(previous.text())
    // Tender subjects are separate uppercase paragraphs preceding the institution link.
    const subject = before && !previous.find('a').length && !/İL[ÂA]NLARI|Resmî Gazete|Sayı\s*:/i.test(before) ? before : ''
    const title = cleanText(`${subject} ${$(a).text()}`)
    result.set(target, {id: identity(target), title, url: target, kind:'ANNOUNCEMENT', parentUrl:entry.url, titleBasis:subject?'SUBJECT_AND_INSTITUTION':'INSTITUTION_ONLY'})
  })
  return [...result.values()]
}
export function assetLinks(html: string, base: string): string[] {
  const $ = load(html), result = new Set<string>()
  if ($('img[src^="data:"],img[srcset],source[srcset],svg,canvas').length) throw new Error('Gömülü data/srcset/SVG/canvas görseli için ek dönüşüm gerekiyor; içerik tam kabul edilmedi.')
  const add = (value?: string) => { if (value && !value.startsWith('#') && !value.startsWith('data:')) result.add(officialUrl(value, base)) }
  $('img[src],iframe[src],embed[src],object[data],input[type=image][src]').each((_, el) => add($(el).attr('src') ?? $(el).attr('data')))
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')!
    if (/\.(pdf|gif|jpe?g|png|webp|bmp|tiff?|docx?|xlsx?|zip)(?:[?#]|$)/i.test(href) || /^(?:ek(?:ler|i)?|ilişik)/i.test(cleanText($(el).text()))) add(href)
  })
  $('[style],style').each((_, el) => { for (const m of ($(el).attr('style') ?? $(el).text()).matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/gi)) add(m[1]) })
  result.delete(base)
  return [...result]
}
