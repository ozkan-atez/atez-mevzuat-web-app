import { load } from 'cheerio'
import { DateTime } from 'luxon'
import type { PrismaClient } from '@prisma/client'
import { activeSourceProfile } from '../../managed-sources/source-profile-store'
import { sourceLogin } from '../../managed-sources/source-secrets'
import { openSourceSession, decodeSource } from '../../managed-sources/source-session'
import type { SourceProfileConfig } from '../../managed-sources/source-profile'
import { collectSource, type SourceCollection } from '../../managed-sources/source-collector'
import { extractPdfText } from '../../managed-sources/pdf-text'
import { normalizeManagedSourceUrl } from '../../managed-sources/fetch-managed-source'
import { normalizeTurkish, resolveTurkishDate } from '../application/resolve-date'

export interface ChatSource { id: string; key: string; title: string; url: string; description: string | null }
export function belongsToChatSource(url: string, base: string): boolean {
  try {
    const target = new URL(normalizeManagedSourceUrl(url)).hostname.replace(/^www\./, '')
    const host = new URL(normalizeManagedSourceUrl(base)).hostname.replace(/^www\./, '')
    return target === host || target.endsWith(`.${host}`)
  } catch { return false }
}

/** Reuses the configured scraper and credentials, without global search or a scan job. */
export async function scrapeChatSource(prisma: PrismaClient, source: ChatSource, query: string, signal?: AbortSignal) {
  const resolved = resolveTurkishDate(query)
  if (resolved && 'error' in resolved) throw new Error(resolved.error)
  const date = resolved?.date ?? DateTime.now().setZone('Europe/Istanbul').toFormat('yyyy-MM-dd')
  let config: SourceProfileConfig
  let generic = false
  try { config = (await activeSourceProfile(prisma, source)).config }
  catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('PROFILE_REQUIRED:')) throw error
    generic = true
    const host = new URL(normalizeManagedSourceUrl(source.url)).hostname.replace(/^www\./, '')
    config = {name: source.title, transport: 'HTTP', allowedHosts: [host, `www.${host}`], feeds: [], auth: {mode: 'NONE'}, maxPages: 1, maxDocuments: 30, delayMs: 300}
  }
  // Profiles may allow official references on other sites. Chat evidence may not.
  const profile = {...config,
    allowedHosts: config.allowedHosts.filter(host => belongsToChatSource(`https://${host}`, source.url)),
    feeds: config.feeds.filter(feed => belongsToChatSource(feed.url, source.url))}
  if (profile.auth.loginUrl) profile.allowedHosts.push(new URL(profile.auth.loginUrl).hostname)
  signal?.throwIfAborted()
  const login = await sourceLogin(prisma, source.id, source.key)
  const session = await openSourceSession(profile, login)
  const abort = () => { void session.close().catch(() => undefined) }
  signal?.addEventListener('abort', abort, {once: true})
  try {
    signal?.throwIfAborted()
    let collection: SourceCollection
    if (generic) {
      const html = await session.html(source.url)
      const $ = load(html)
      const links = new Map<string, string>([[source.url, source.title]])
      $('a[href]').each((_index, element) => {
        try {
          const url = new URL($(element).attr('href')!, source.url).toString()
          const title = $(element).text().trim()
          if (title && belongsToChatSource(url, source.url) && links.size < 30) links.set(url, title.slice(0, 300))
        } catch { /* Invalid links are not evidence. */ }
      })
      collection = {items: [...links].map(([url,title]) => ({url, title, publishedOn: null, feedUrl: source.url})), warnings: ['Doğrulanmış tarama profili yok; yalnızca başlangıç sayfası ve görünür bağlantılar incelendi. Yayın tarihleri doğrulanamadı.'], pages: [source.url], observed: links.size, oldestDate: null, newestDate: null}
    } else collection = await collectSource(profile, date, session, login, resolved ? 'PUBLISHED_DATE' : 'NEW_OR_CHANGED')
    signal?.throwIfAborted()
    const words = normalizeTurkish(query).split(/\W+/).filter(word => word.length > 3)
    const candidates = collection.items.filter(item => belongsToChatSource(item.url, source.url) && (!resolved || generic || item.publishedOn === date))
    const score = (title: string) => words.reduce((value, word) => value + Number(normalizeTurkish(title).includes(word)), 0)
    candidates.sort((a,b) => score(b.title) - score(a.title))
    const documents: Array<{title: string; url: string; publishedOn: string | null; text: string}> = []
    const warnings = [...collection.warnings]
    if (!resolved && profile.transport === 'GAZETTE') warnings.push(`Tarih belirtilmediği için ${date} tarihli gazete incelendi.`)
    if (candidates.length > 6) warnings.push('En ilgili 6 belge okundu; sonuçlar kaynağın tamamını kapsamaz.')
    for (const item of candidates.slice(0, 6)) {
      signal?.throwIfAborted()
      try {
        let text = item.capturedContent ?? ''
        if (!text) {
          const resource = await session.binary(item.url, 4_000_000)
          if (!belongsToChatSource(resource.finalUrl, source.url)) throw new Error('Seçili kaynak dışına yönlendirme engellendi.')
          if (/pdf/i.test(resource.contentType)) text = await extractPdfText(resource.body) ?? ''
          else if (/html|text\//i.test(resource.contentType)) {
            const $ = load(decodeSource(resource));$('script,style,nav,header,footer,noscript').remove()
            text = $('main,article').first().text() || $('body').text()
          }
        }
        if (text.trim()) documents.push({title: item.title, url: item.url, publishedOn: item.publishedOn, text: text.replace(/\s+/g, ' ').trim().slice(0, 12000)})
        else warnings.push(`${item.title}: Okunabilir metin alınamadı.`)
      } catch {
        if (signal?.aborted) signal.throwIfAborted()
        warnings.push(`${item.title}: İçeriğe erişilemedi; hesap, abonelik veya kaynak profilini kontrol edin.`)
      }
    }
    return {source: {id: source.id, title: source.title, url: source.url}, fetchedAt: new Date().toISOString(), targetDate: resolved ? date : null, inspectedPages: collection.pages, matchedItems: candidates.map(({title,url,publishedOn,feedUrl})=>({title,url,publishedOn,feedUrl})), documents, warnings, notes: collection.notes ?? [], scope: 'Yalnızca seçilen kaynak; genel web veya diğer kaynaklar kullanılmadı.'}
  } finally { signal?.removeEventListener('abort', abort); await session.close() }
}
