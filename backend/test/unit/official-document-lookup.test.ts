import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { CachedOfficialLookup } from '../../src/modules/chat/infrastructure/official-document-lookup'

const sourceUrl = 'https://www.resmigazete.gov.tr/eskiler/2026/09/20260911-1.htm'

function fixture() {
  const rows = new Map<string, any>()
  const prisma = {
    collectedDocument: { findMany: vi.fn().mockResolvedValue([]) },
    assistantOfficialDocument: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(async ({ where }: any) => rows.get(where.sourceUrl) ?? null),
      upsert: vi.fn(async ({ where, create }: any) => {
        const row = rows.get(where.sourceUrl) ?? { ...create, fetchedAt: new Date('2026-09-21T00:00:00Z') }
        rows.set(where.sourceUrl, row)
        return row
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = { ...rows.get(where.sourceUrl), ...data }
        rows.set(where.sourceUrl, row)
        return row
      }),
    },
  }
  const store = { putRunFile: vi.fn().mockResolvedValue({}) }
  const lookup = new CachedOfficialLookup(prisma as unknown as PrismaClient, store, {
    hosts: ['www.resmigazete.gov.tr'], delayMs: 750, timeoutMs: 2_000, maxAttempts: 1, maxFileBytes: 50_000,
  })
  return { lookup, prisma, store }
}

afterEach(() => vi.unstubAllGlobals())

describe('CachedOfficialLookup', () => {
  it('searches the official index only after the local archive misses and keeps multiple matches', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: [
      { konu: 'İthalat Kararı', resmiGazeteTarihiFormatted: '11.09.2026', url: '/eskiler/2026/09/20260911-1.htm' },
      { konu: 'İthalat Tebliği', resmiGazeteTarihiFormatted: '11.09.2026', url: '/eskiler/2026/09/20260911-2.htm' },
    ] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { lookup } = fixture()
    const result = await lookup.search({ query: 'İthalat', endDate: '2026-09-11', limit: 5 })
    expect(result.origin).toBe('official')
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[1]?.sourceUrl).toContain('20260911-2.htm')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caches a selected HTML document separately and never downloads it twice', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html><head><title>İthalat Kararı</title></head><body><p>Gözetim uygulanır.</p></body></html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { lookup, store } = fixture()
    const first = await lookup.getDocument({ sourceUrl })
    const second = await lookup.getDocument({ sourceUrl })
    expect(first).toMatchObject({ title: 'İthalat Kararı', text: expect.stringContaining('Gözetim uygulanır.'), sourceUrl })
    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(store.putRunFile).toHaveBeenCalledTimes(1)
  })

  it('preserves an unresolved index candidate rather than silently discarding it', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [
        { konu: 'İthalat Kararı', resmiGazeteTarihiFormatted: '11.09.2026', url: '/fihrist?tarih=2026-09-11' },
      ] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('<html><body>Henüz bağlantı yok</body></html>', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { lookup } = fixture()
    const result = await lookup.search({ query: 'İthalat', limit: 5 })
    expect(result.candidates).toMatchObject([{ title: 'İthalat Kararı', requiresResolution: true }])
    expect(result.candidates[0]?.sourceUrl).toContain('/fihrist')
  })

  it('refuses other hosts and unsupported official paths without fetching', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const { lookup } = fixture()
    await expect(lookup.getDocument({ sourceUrl: 'https://example.com/secret' })).rejects.toThrow(/host is not allowed/)
    await expect(lookup.getDocument({ sourceUrl: 'https://www.resmigazete.gov.tr/Home/Filter' })).rejects.toThrow(/arşiv belgeleri/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not invent text for an unreadable PDF', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('%PDF-broken', { status: 200, headers: { 'content-type': 'application/pdf' } })))
    const { lookup } = fixture()
    const result = await lookup.getDocument({ sourceUrl: sourceUrl.replace('.htm', '.pdf') })
    expect(result).toMatchObject({ mediaType: 'application/pdf', text: null, note: expect.stringContaining('çıkarılamadı') })
  })

  it('repairs an already cached PDF with a corrupt text layer', async () => {
    const { lookup, prisma } = fixture()
    const pdfUrl = sourceUrl.replace('.htm', '.pdf')
    prisma.assistantOfficialDocument.findUnique.mockResolvedValueOnce({
      title: 'Tebliğ', mediaType: 'application/pdf', text: '\u000e0=+>8<9 '.repeat(30), note: null,
      fetchedAt: new Date('2026-09-21T00:00:00Z'),
    })
    const result = await lookup.getDocument({ sourceUrl: pdfUrl })
    expect(result).toMatchObject({ text: null, note: expect.stringContaining('çıkarılamadı') })
    expect(prisma.assistantOfficialDocument.update).toHaveBeenCalledWith({ where: { sourceUrl: pdfUrl }, data: { text: null, note: expect.any(String) } })
  })
})
