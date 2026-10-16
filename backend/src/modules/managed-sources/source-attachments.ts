import { SourceSizeLimitError, captureFailure } from './capture-error'
import { extractOfficeText } from './document-text'
import { assertContentAccess } from './source-profile'
import { createHash } from 'node:crypto'
import { load } from 'cheerio'
import { fileTypeFromBuffer } from 'file-type'
import type { ObjectStore } from '../scan-runs/application/ports'
import { fetchSourceBinary, normalizeManagedSourceUrl } from './fetch-managed-source'
import { extractPdfText } from './pdf-text'

export interface CapturedSourceFile {
  url: string; title: string; role: 'DOCUMENT' | 'ATTACHMENT' | 'IMAGE'; status: 'STORED' | 'FAILED'
  resolvedUrl?: string; capturedAt?: string; mediaType?: string; byteSize?: number; sha256?: string; objectKey?: string; bucket?: string; error?: string; failure?: ReturnType<typeof captureFailure>
}
export interface SourceCapture { contentText: string | null; files: CapturedSourceFile[]; errors: string[]; status: 'COMPLETED' | 'PARTIAL' | 'FAILED' }
const supportedPath = /\.(?:pdf|png|jpe?g|gif|webp|svg|bmp|tiff?|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z)$/i
export function discoverAttachments(html: string, documentUrl: string, sourceBaseUrl: string): Array<{ url: string; title: string; role: 'ATTACHMENT' | 'IMAGE' }> {
  const $ = load(html)
  $('nav,header,footer,aside,script,style,noscript').remove()
  const root = new URL(sourceBaseUrl).hostname.replace(/^www\./, '')
  // Legacy publishers lack semantic article tags; use their content containers.
  const publisherScope = root === 'igmd.org.tr' ? $('section').has('.haber-dokuman-kart,h1').first() : root === 'mevzuat.net' ? $('#SiteGenelContent') : $('main,article').first()
  const scope = publisherScope.length ? publisherScope : $('body')
  scope.find('.haberler,.sharethis-inline-share-buttons,[id*=Reklam],.breadcrumb,.modal').remove()
  const found = new Map<string, { url: string; title: string; role: 'ATTACHMENT' | 'IMAGE' }>()
  const add = (raw: string | undefined, title: string, image: boolean) => {
    if (!raw) return
    try {
      const url = new URL(normalizeManagedSourceUrl(new URL(raw, documentUrl).toString()))
      const host = url.hostname.replace(/^www\./, '')
      const officialReference = ['ticaret.gov.tr','resmigazete.gov.tr','mevzuat.gov.tr','tbmm.gov.tr'].some(domain=>host===domain || host.endsWith(`.${domain}`))
      if (host !== root && !host.endsWith(`.${root}`) && !officialReference) return
      if (url.toString() === documentUrl || (!image && !supportedPath.test(url.pathname) && !/download|dosya|attachment/i.test(url.pathname))) return
      found.set(url.toString(), { url: url.toString(), title: title.trim().slice(0,200) || (image ? 'Görsel' : 'Belge eki'), role: image ? 'IMAGE' : 'ATTACHMENT' })
    } catch { /* Invalid and private destinations are never followed. */ }
  }
  scope.find('a[href]').each((_i, node) => add($(node).attr('href'), $(node).text(), false))
  scope.find('img').each((_i, node) => { for (const attr of ['src','data-src','data-original']) add($(node).attr(attr), $(node).attr('alt') ?? '', true); for (const candidate of ($(node).attr('srcset')?.startsWith('data:') ? '' : $(node).attr('srcset') ?? '').split(',')) add(candidate.trim().split(/\s+/)[0], $(node).attr('alt') ?? '', true) })
  scope.find('source[srcset]').each((_i,node) => { for(const candidate of ($(node).attr('srcset')??'').split(',')) add(candidate.trim().split(/\s+/)[0], 'Görsel', true) })
  scope.find('[style]').each((_i,node)=>{ for(const match of ($(node).attr('style')??'').matchAll(/url\(["']?([^"')]+)["']?\)/g)) add(match[1], 'İçerik görseli', true) })
  scope.find('iframe[src],embed[src],object[data]').each((_i, node) => add($(node).attr('src') ?? $(node).attr('data'), 'Gömülü belge', false))
  return [...found.values()]
}
export async function captureSourceDocument(
  url: string, sourceBaseUrl: string, store: Pick<ObjectStore,'putRunFile'>,
  extra: Array<{url:string;title:string}> = [], maxTotalBytes = 100_000_000,
  fetcher: (url:string,maxBytes:number) => Promise<{body:Buffer;contentType:string;finalUrl?:string}> = fetchSourceBinary,
  options: {extractPdfText?:boolean;maxFileBytes?:number} = {},
): Promise<SourceCapture> {
  const files: CapturedSourceFile[] = []; const errors: string[] = []; const texts: string[] = []
  const maxFileBytes=options.maxFileBytes??25_000_000
  let total = 0
  let html: string | null = null
  let htmlBase = url
  const capture = async (candidate: {url:string;title:string;role:CapturedSourceFile['role']}) => {
    try {
      if (maxTotalBytes - total <= 0) throw new Error('Tarama boyut sınırı aşıldı.')
      const resource = await fetcher(candidate.url, Math.min(maxFileBytes, maxTotalBytes - total))
      if(resource.body.length>Math.min(maxFileBytes,maxTotalBytes-total))throw new SourceSizeLimitError(candidate.url,Math.min(maxFileBytes,maxTotalBytes-total),resource.body.length)
      if(!resource.body.length)throw new Error('Dosya boş')
      total += resource.body.length
      let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>
      try { detected = await fileTypeFromBuffer(resource.body) } catch { detected = undefined }
      const mediaType = detected?.mime ?? resource.contentType.split(';')[0]?.trim() ?? 'application/octet-stream'
      if (/\.pdf$/i.test(new URL(candidate.url).pathname) && mediaType !== 'application/pdf') throw new Error('PDF bağlantısı PDF içeriği döndürmedi.')
      if (candidate.role === 'IMAGE' && !mediaType.startsWith('image/')) throw new Error('Görsel bağlantısı görsel içeriği döndürmedi.')
      if (/javascript|x-executable|x-msdownload/.test(mediaType)) throw new Error('Çalıştırılabilir içerik desteklenmiyor.')
      const sha256 = createHash('sha256').update(resource.body).digest('hex')
      const stored = await store.putRunFile(`source-captures/${sha256}`, resource.body, mediaType || 'application/octet-stream')

      if (mediaType === 'application/pdf' && options.extractPdfText!==false) {
        try { const text = await extractPdfText(resource.body); if (text) texts.push(`Kaynak: ${candidate.url}\n${text.slice(0,40000)}`) } catch { /* The original remains available even if it needs OCR. */ }
      } else if (/html/i.test(mediaType)) {
        const encoding = /charset\s*=\s*["']?windows-1254/i.test(`${resource.contentType} ${resource.body.subarray(0,2000).toString('latin1')}`) ? 'windows-1254' : 'utf-8'
        const decoded = new TextDecoder(encoding).decode(resource.body)
        if (candidate.role === 'DOCUMENT') { html = decoded; htmlBase = resource.finalUrl ?? candidate.url }
        assertContentAccess(decoded,resource.finalUrl??candidate.url)
        const $ = load(decoded); $('script,style,nav,header,footer,aside,noscript').remove(); $('br,p,li,tr').append('\n')
        const text = $('body').text().replace(/[ \t]+/g,' ').trim()
        if (text) texts.push(`Kaynak: ${candidate.url}\n${text.slice(0,40000)}`)
      } else if (/wordprocessingml|spreadsheetml/.test(mediaType)) {
        const text=await extractOfficeText(resource.body,mediaType);if(text)texts.push(`Kaynak: ${candidate.url}\n${text}`)
      } else if (/text\//.test(mediaType)) texts.push(`Kaynak: ${candidate.url}\n${resource.body.toString('utf8').slice(0,40000)}`)
      files.push({ ...candidate, status: 'STORED', capturedAt: new Date().toISOString(), ...(resource.finalUrl ? {resolvedUrl:resource.finalUrl} : {}), mediaType, byteSize: resource.body.length, sha256, objectKey: stored.objectKey, bucket: stored.bucket })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Dosya indirilemedi.'
      files.push({ ...candidate, status: 'FAILED', error: message.slice(0,300), failure:captureFailure(error,candidate.url,Math.min(maxFileBytes,Math.max(0,maxTotalBytes-total))) }); errors.push(`${candidate.title}: ${message}`)
    }
  }
  await capture({ url, title: 'Özgün belge', role: 'DOCUMENT' })
  if (files[0]?.status === 'STORED') {
    const links = discoverAttachments(html ?? '', htmlBase, sourceBaseUrl)
    // Feed rows may contain PDF/XLSX annexes beside the primary PDF.
    for (const candidate of extra) links.push(...discoverAttachments(`<a href="${candidate.url.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">${candidate.title.replace(/[<>]/g,'')}</a>`, url, sourceBaseUrl))
    const unique = [...new Map(links.map(link=>[link.url,link])).values()].filter(link=>link.url!==url)
    if (unique.length > 40) errors.push('40 ek dosya sınırı aşıldı; tüm ekler alınamadı.')
    for (const link of unique.slice(0,40)) await capture(link)
  }
  return { files, errors, contentText: texts.join('\n\n').slice(0,200000) || null, status: files[0]?.status !== 'STORED' ? 'FAILED' : errors.length ? 'PARTIAL' : 'COMPLETED' }
}
