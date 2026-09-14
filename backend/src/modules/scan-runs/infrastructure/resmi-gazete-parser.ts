import { load } from 'cheerio'
import { DateTime } from 'luxon'
import type { AssetRole, DiscoveredAsset, DiscoveredEdition } from '../application/ports'
import { SourcePolicy } from '../domain/source-policy'

const hosts = ['resmigazete.gov.tr', 'www.resmigazete.gov.tr']
const policy = new SourcePolicy(hosts)
const supportedAssetExtensions = new Set(['.pdf', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.webp'])
const cssUrlPattern = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/gi

export function candidateIndexUrls(date: string): string[] {
  const parsed = DateTime.fromFormat(date, 'yyyy-MM-dd', { zone: 'Europe/Istanbul' })
  if (!parsed.isValid || parsed.toFormat('yyyy-MM-dd') !== date) {
    throw new Error('date must use a real YYYY-MM-DD value')
  }
  return [
    `https://www.resmigazete.gov.tr/${parsed.toFormat('dd.MM.yyyy')}`,
    `https://www.resmigazete.gov.tr/eskiler/${parsed.toFormat('yyyy/MM')}/${parsed.toFormat('yyyyMMdd')}.htm`,
  ]
}

export function parseEditions(html: string, indexUrl: string, targetDate: string): DiscoveredEdition[] {
  const parsedDate = DateTime.fromFormat(targetDate, 'yyyy-MM-dd', { zone: 'Europe/Istanbul' })
  if (!parsedDate.isValid) throw new Error('target date is invalid')
  const stem = parsedDate.toFormat('yyyyMMdd')
  const expectedDirectory = `/eskiler/${parsedDate.toFormat('yyyy/MM')}/`
  const announcementDirectory = `/ilanlar/eskiilanlar/${parsedDate.toFormat('yyyy/MM')}/`
  const filenamePattern = new RegExp(`^${stem}(?:M([1-9][0-9]*))?-[1-9][0-9]*(?:-[1-9][0-9]*)?\\.(?:html?|pdf)$`, 'i')
  const announcementPattern = new RegExp(`^${stem}-[1-9][0-9]*\\.html?$`, 'i')
  const $ = load(html)
  const grouped = new Map<number | null, DiscoveredEdition>()
  const seen = new Set<string>()

  $('a[href]').each((_index, element) => {
    const href = $(element).attr('href')?.trim()
    if (!href || hasTraversal(href)) return
    let url: URL
    try {
      url = resolveOfficialDocumentUrl(href, indexUrl)
    } catch {
      return
    }
    const isPublication = url.pathname.startsWith(expectedDirectory)
    const isAnnouncement = url.pathname.startsWith(announcementDirectory)
    if ((!isPublication && !isAnnouncement) || seen.has(url.toString())) return
    const filename = url.pathname.slice(url.pathname.lastIndexOf('/') + 1)
    const match = isPublication ? filenamePattern.exec(filename) : null
    if ((isPublication && !match) || (isAnnouncement && !announcementPattern.test(filename))) return
    seen.add(url.toString())
    const supplementNo = match?.[1] ? Number(match[1]) : null
    const edition = grouped.get(supplementNo) ?? {
      type: supplementNo === null ? 'MAIN' : 'SUPPLEMENT',
      supplementNo,
      indexUrl: supplementNo === null
        ? indexUrl
        : `https://www.resmigazete.gov.tr/fihrist?mukerrer=${supplementNo}&tarih=${targetDate}`,
      discoveryOrder: 0,
      documents: [],
    }
    edition.documents.push({
      title: normalizeText($(element).text()) || filename,
      sourceUrl: url.toString(),
      publicationOrder: edition.documents.length,
    })
    grouped.set(supplementNo, edition)
  })

  return [...grouped.values()]
    .sort((a, b) => (a.supplementNo ?? 0) - (b.supplementNo ?? 0))
    .map((edition, discoveryOrder) => ({ ...edition, discoveryOrder }))
}

function resolveOfficialDocumentUrl(href: string, indexUrl: string): URL {
  const outer = new URL(href, indexUrl)
  if (outer.pathname.toLowerCase() !== '/main.aspx') {
    return policy.assertAllowedUrl(outer.toString())
  }
  if (!hosts.includes(outer.hostname.toLowerCase())) {
    throw new Error('Legacy wrapper host is not allowed')
  }
  const nestedValue = outer.searchParams.get('main')
  if (!nestedValue) throw new Error('Legacy wrapper has no document URL')
  const nested = new URL(nestedValue)
  if (nested.protocol === 'http:') nested.protocol = 'https:'
  return policy.assertAllowedUrl(nested.toString())
}

export function parseAssets(html: string, documentUrl: string): DiscoveredAsset[] {
  const $ = load(html)
  const baseHref = $('base[href]').first().attr('href')
  let effectiveBase = documentUrl
  if (baseHref && !hasTraversal(baseHref)) {
    try {
      effectiveBase = policy.assertAllowedUrl(new URL(baseHref, documentUrl).toString(), documentUrl).toString()
    } catch {
      effectiveBase = documentUrl
    }
  }

  const references: Array<{ value: string; role: AssetRole; text?: string }> = []
  $('img[src], source[src]').each((_index, element) => {
    const value = $(element).attr('src')
    const text = $(element).attr('alt')
    if (value) references.push({ value, role: 'IMAGE', ...(text ? { text } : {}) })
  })
  $('img[srcset], source[srcset]').each((_index, element) => {
    for (const candidate of ($(element).attr('srcset') ?? '').split(',')) {
      const value = candidate.trim().split(/\s+/, 1)[0]
      if (value) references.push({ value, role: 'IMAGE' })
    }
  })
  $('a[href]').each((_index, element) => {
    const value = $(element).attr('href')
    if (value) {
      const extension = extensionOf(value)
      if (!supportedAssetExtensions.has(extension)) return
      references.push({
        value,
        role: extension === '.pdf' ? 'ATTACHMENT' : 'IMAGE',
        text: normalizeText($(element).text()),
      })
    }
  })
  $('[style], style').each((_index, element) => {
    const css = element.tagName === 'style' ? $(element).text() : ($(element).attr('style') ?? '')
    for (const match of css.matchAll(cssUrlPattern)) {
      const value = match[1] ?? match[2] ?? match[3]
      if (value) references.push({ value, role: 'STYLESHEET_ASSET' })
    }
  })

  const assets: DiscoveredAsset[] = []
  const seen = new Set<string>()
  for (const reference of references) {
    if (hasTraversal(reference.value)) continue
    try {
      const url = policy.assertAllowedUrl(new URL(reference.value, effectiveBase).toString(), documentUrl)
      url.hash = ''
      if (!supportedAssetExtensions.has(extensionOf(url.pathname)) || seen.has(url.toString())) continue
      seen.add(url.toString())
      assets.push({
        sourceUrl: url.toString(),
        role: reference.role,
        ...(reference.text ? { referenceText: reference.text } : {}),
      })
    } catch {
      continue
    }
  }
  return assets
}

function extensionOf(value: string): string {
  const pathname = (() => {
    try { return new URL(value, 'https://placeholder.invalid').pathname } catch { return value }
  })()
  const filename = pathname.slice(pathname.lastIndexOf('/') + 1)
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot).toLowerCase()
}

function hasTraversal(value: string): boolean {
  return value.split(/[/?#]/).some((part) => part === '..' || part.toLowerCase() === '%2e%2e')
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
