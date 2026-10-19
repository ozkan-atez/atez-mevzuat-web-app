import { load } from 'cheerio'
import iconv from 'iconv-lite'

/**
 * HTML biçim normalizasyonu (§6.1: HTML modele metin olarak verilir). Metin çıkarma değil:
 * kodlama UTF-8'e çevrilir, Word/MSO gürültüsü (koşullu yorumlar, <style>, <xml>, o:p,
 * mso-* stilleri) temizlenir; tablo ve paragraf yapısı korunur.
 */
export function detectCharset(body: Buffer, contentType: string | null): string {
  const fromHeader = contentType?.match(/charset=([\w-]+)/i)?.[1]
  if (fromHeader) return fromHeader.toLowerCase()
  const head = body.subarray(0, 4096).toString('latin1')
  const meta = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1]
  return (meta ?? 'utf-8').toLowerCase()
}

export function decodeHtml(body: Buffer, contentType: string | null): { html: string; encoding: string } {
  const encoding = detectCharset(body, contentType)
  const html = iconv.encodingExists(encoding) ? iconv.decode(body, encoding) : body.toString('utf8')
  return { html, encoding }
}

export function cleanWordHtml(html: string): string {
  const withoutConditionals = html.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '').replace(/<!--[\s\S]*?-->/g, '')
  const $ = load(withoutConditionals)
  $('style, script, xml, link, meta, o\\:p').remove()
  $('*').each((_, el) => {
    const node = $(el)
    const cls = node.attr('class')
    if (cls && /^Mso/i.test(cls)) node.removeAttr('class')
    const style = node.attr('style')
    if (style) {
      const kept = style
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s && !/^mso-|^font-family|^font-size|^line-height|^margin|^text-indent|^tab-stops|^layout-grid/i.test(s))
        .join('; ')
      if (kept) node.attr('style', kept)
      else node.removeAttr('style')
    }
    for (const attr of ['lang', 'xml:lang', 'width', 'valign', 'nowrap']) node.removeAttr(attr)
  })
  const body = $('body').html() ?? $.root().html() ?? ''
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"></head><body>${body.replace(/\n{3,}/g, '\n\n')}</body></html>`
}

/** Alıntı doğrulaması için düz metin görünümü (saklanmaz; yalnızca karşılaştırma). */
export function visibleText(html: string): string {
  const $ = load(html)
  $('script, style').remove()
  return ($('body').text() || $.root().text()).replace(/[\u00a0\u2002-\u200b]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function normalizeForQuote(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[\u00a0\u2002-\u200b]/g, ' ')
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('tr')
}

export interface AssetLink {
  url: string
  kind: 'IMAGE' | 'DOCUMENT'
}

/**
 * Belgenin kendi içeriğindeki ekler: görseller ve belge bağlantıları (pdf/docx/xlsx/zip).
 * Aynı RG alanı dışındaki adresler `skipped` olarak döner (§9.1 içerik kapsamı).
 */
export function assetLinks(html: string, baseUrl: string, allowedHosts: readonly string[]): { assets: AssetLink[]; skipped: { url: string; reason: string }[] } {
  const $ = load(html)
  const found = new Map<string, AssetLink>()
  const skipped: { url: string; reason: string }[] = []
  const add = (href: string | undefined, kind: AssetLink['kind']) => {
    if (!href || href.startsWith('#') || href.startsWith('data:') || href.startsWith('mailto:')) return
    let u: URL
    try {
      u = new URL(href, baseUrl)
    } catch {
      return
    }
    u.hash = ''
    if (!allowedHosts.includes(u.hostname)) {
      skipped.push({ url: u.toString(), reason: 'OUTSIDE_CONTENT_SCOPE' })
      return
    }
    u.protocol = 'https:'
    if (u.toString() !== baseUrl) found.set(u.toString(), { url: u.toString(), kind })
  }
  $('img[src]').each((_, el) => add($(el).attr('src'), 'IMAGE'))
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')!
    if (/\.(pdf|docx?|xlsx?|zip)(?:[?#]|$)/i.test(href)) add(href, 'DOCUMENT')
    else if (/\.(gif|jpe?g|png|webp)(?:[?#]|$)/i.test(href)) add(href, 'IMAGE')
  })
  return { assets: [...found.values()], skipped }
}
