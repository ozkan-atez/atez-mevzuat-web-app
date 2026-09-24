import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'cheerio'
import type { PrismaClient } from '@prisma/client'
import { OfficialHttpClient } from '../../scan-runs/infrastructure/official-http-client'
import { ResmiGazeteSearch } from '../../scan-runs/infrastructure/resmi-gazete-search'
import { SourcePolicy } from '../../scan-runs/domain/source-policy'
import { extractPdfText, isReadablePdfText } from './pdf-text'
import type { OfficialDocument, OfficialSearchResult } from '../application/assistant-knowledge'

export interface OfficialLookup {
  search(input: { query: string; endDate?: string; limit: number }): Promise<OfficialSearchResult>
  getDocument(input: { sourceUrl: string; title?: string; publicationDate?: string }): Promise<OfficialDocument | null>
}

interface Store { putRunFile(key: string, body: Buffer, mediaType: string): Promise<unknown> }

export class CachedOfficialLookup implements OfficialLookup {
  private readonly policy: SourcePolicy
  private readonly searchClient: ResmiGazeteSearch
  private readonly http: OfficialHttpClient

  constructor(private readonly prisma: PrismaClient, private readonly store: Store, options: {
    hosts: string[]; delayMs: number; timeoutMs: number; maxAttempts: number; maxFileBytes: number
  }) {
    this.policy = new SourcePolicy(options.hosts)
    this.searchClient = new ResmiGazeteSearch(this.policy, { timeoutMs: options.timeoutMs, fetch: boundedIndexFetch })
    this.http = new OfficialHttpClient(this.policy, options)
  }

  async search(input: { query: string; endDate?: string; limit: number }): Promise<OfficialSearchResult> {
    const query = input.query.trim().slice(0, 200)
    if (query.length < 3) throw new Error('Arama için en az üç karakter gerekir.')
    const local = await this.prisma.collectedDocument.findMany({
      where: { title: { contains: query, mode: 'insensitive' }, ...(input.endDate ? { edition: { publicationDate: { lte: new Date(`${input.endDate}T00:00:00.000Z`) } } } : {}) },
      include: { edition: { select: { publicationDate: true } } }, take: input.limit,
      orderBy: { edition: { publicationDate: 'desc' } },
    })
    if (local.length) return { origin: 'archive', candidates: local.map((item) => ({ title: item.title, publicationDate: item.edition.publicationDate.toISOString().slice(0, 10), sourceUrl: item.sourceUrl, documentId: item.id })) }
    const cached = await this.prisma.assistantOfficialDocument.findMany({
      where: { title: { contains: query, mode: 'insensitive' } }, orderBy: { fetchedAt: 'desc' }, take: input.limit,
    })
    const cachedCandidates = cached.map((item) => ({ title: item.title, publicationDate: publicationDateFromUrl(item.sourceUrl) ?? item.fetchedAt.toISOString().slice(0, 10), sourceUrl: item.sourceUrl }))
      .filter((item) => !input.endDate || item.publicationDate <= input.endDate)
    if (cachedCandidates.length) return { origin: 'archive', candidates: cachedCandidates }
    const matches = await this.searchClient.search({ query, endDate: input.endDate ?? new Date().toISOString().slice(0, 10), limit: input.limit })
    const candidates = await Promise.all(matches.map(async (item) => {
      try {
        const sourceUrl = await this.searchClient.resolveDocumentUrl(item, { targetRegulationIdentifier: null, targetRegulationTitle: item.title })
        return { title: item.title, publicationDate: item.publicationDate, sourceUrl }
      } catch { return { title: item.title, publicationDate: item.publicationDate, sourceUrl: item.url, requiresResolution: true } }
    }))
    return { origin: 'official', candidates: candidates.flatMap((item) => item ? [item] : []) }
  }

  async getDocument(input: { sourceUrl: string; title?: string; publicationDate?: string }): Promise<OfficialDocument | null> {
    let url = this.policy.assertAllowedUrl(input.sourceUrl)
    if (url.pathname.toLowerCase() === '/fihrist') {
      if (!input.title || !input.publicationDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.publicationDate)) throw new Error('Fihrist belgesi için arama sonucunun başlığı ve tarihi gerekir.')
      url = this.policy.assertAllowedUrl(await this.searchClient.resolveDocumentUrl({
        query: input.title, title: input.title, publicationDate: input.publicationDate,
        gazetteNo: null, mukerrer: url.searchParams.get('mukerrer'), url: url.toString(), regulationType: null,
      }, { targetRegulationIdentifier: null, targetRegulationTitle: input.title }))
    }
    if (!/^\/(?:eskiler|ilanlar\/eskiilanlar)\/\d{4}\/\d{2}\//.test(url.pathname)) throw new Error('Yalnızca Resmî Gazete arşiv belgeleri okunabilir.')
    const sourceUrl = url.toString()
    const cached = await this.prisma.assistantOfficialDocument.findUnique({ where: { sourceUrl } })
    if (cached) {
      if (cached.mediaType === 'application/pdf' && cached.text && !isReadablePdfText(cached.text)) {
        const note = 'Belge metni çıkarılamadı; kaynak bağlantısı üzerinden incelenebilir.'
        await this.prisma.assistantOfficialDocument.update({ where: { sourceUrl }, data: { text: null, note } })
        return { title: cached.title, sourceUrl, mediaType: cached.mediaType, text: null, note, fetchedAt: cached.fetchedAt.toISOString() }
      }
      return { title: cached.title, sourceUrl, mediaType: cached.mediaType, text: cached.text, ...(cached.note ? { note: cached.note } : {}), fetchedAt: cached.fetchedAt.toISOString() }
    }

    const directory = await mkdtemp(join(tmpdir(), 'atez-chat-source-'))
    try {
      const file = await this.http.download(sourceUrl, directory)
      if (file.mediaType !== 'text/html' && file.mediaType !== 'application/pdf') throw new Error('Belge HTML veya PDF olmalıdır.')
      const bytes = await readFile(file.tempPath)
      const $ = file.mediaType === 'text/html' ? load(decodeHtml(bytes)) : null
      const title = ($ ? $('title').first().text().trim().slice(0, 300) : '') || url.pathname.split('/').at(-1) || 'Resmî Gazete belgesi'
      let text: string | null
      if ($) {
        $('script, style, nav, header, footer, aside, noscript').remove()
        $('br, p, li, tr').each((_index, element) => { $(element).append('\n') })
        text = $('body').text().replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20_000) || null
      } else {
        try { text = await extractPdfText(bytes) } catch { text = null }
      }
      const note = text ? null : 'Belge metni çıkarılamadı; kaynak bağlantısı üzerinden incelenebilir.'
      const hash = createHash('sha256').update(sourceUrl).digest('hex')
      const objectKey = `assistant-official/${hash}/${file.sha256}.${file.mediaType === 'application/pdf' ? 'pdf' : 'html'}`
      await this.store.putRunFile(objectKey, bytes, file.mediaType)
      const saved = await this.prisma.assistantOfficialDocument.upsert({
        where: { sourceUrl }, update: {},
        create: { sourceUrl, title, mediaType: file.mediaType, objectKey, text, note },
      })
      return { title: saved.title, sourceUrl, mediaType: saved.mediaType, text: saved.text, ...(saved.note ? { note: saved.note } : {}), fetchedAt: saved.fetchedAt.toISOString() }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}

function decodeHtml(bytes: Buffer): string {
  const head = bytes.subarray(0, Math.min(bytes.length, 2_000)).toString('latin1')
  return new TextDecoder(/charset\s*=\s*["']?windows-1254/i.test(head) ? 'windows-1254' : 'utf-8').decode(bytes)
}

async function boundedIndexFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init)
  const limit = 2_000_000
  if (Number(response.headers.get('content-length') ?? 0) > limit) throw new Error('Resmî Gazete arama yanıtı çok büyük.')
  if (!response.body) return response
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('Resmî Gazete arama yanıtı çok büyük.')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => undefined) }
  return new Response(Uint8Array.from(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))), { status: response.status, statusText: response.statusText, headers: response.headers })
}

function publicationDateFromUrl(sourceUrl: string): string | null {
  const match = new URL(sourceUrl).pathname.match(/\/(\d{4})\/(\d{2})\/(\d{4})(\d{2})(\d{2})/)
  return match ? `${match[3]}-${match[4]}-${match[5]}` : null
}
