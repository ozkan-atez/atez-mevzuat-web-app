import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSourceHtml } from '../../src/modules/managed-sources/fetch-managed-source'
import { scrapeSourceFeed } from '../../src/modules/managed-sources/source-feed-scrapers'
vi.mock('../../src/modules/managed-sources/fetch-managed-source', async original => ({ ...await original<typeof import('../../src/modules/managed-sources/fetch-managed-source')>(), fetchSourceHtml: vi.fn() }))
afterEach(() => vi.resetAllMocks())
const input = { adapter: 'TICARET_DUYURULAR', url: 'https://ggm.ticaret.gov.tr/duyurular', sourceKey: 'ticaret-bakanligi', targetDate: '2026-10-11' }
describe('Ticaret announcement file links', () => {
  it('retains an undated PDF as a coverage warning without attempting HTML parsing', async () => {
    vi.mocked(fetchSourceHtml).mockImplementation(async url => url === input.url ? '<ul class="dizin-content"><li><a href="https://ticaret.gov.tr/data/guide.pdf">Kılavuz</a></li><li><a href="/duyurular/news">Haber</a></li></ul>' : '<div class="__header"><span>10 Ekim 2026</span></div>')
    const result = await scrapeSourceFeed(input)
    expect(result).toHaveLength(0)
    expect(result.coverageWarnings?.[0]).toContain('Yayın tarihi belirtilmeyen dosya')
    expect(fetchSourceHtml).toHaveBeenCalledTimes(2)
  })
  it('includes dated PDF announcements only on their published date', async () => {
    vi.mocked(fetchSourceHtml).mockResolvedValue('<ul class="dizin-content"><li><a href="https://ticaret.gov.tr/data/guide.pdf">Kılavuz</a><span>11 Ekim 2026</span></li></ul>')
    expect(await scrapeSourceFeed(input)).toMatchObject([{ title: 'Kılavuz', publishedOn: '2026-10-11' }])
    expect(await scrapeSourceFeed({ ...input, targetDate: '2026-10-12' })).toHaveLength(0)
  })
  it('preserves the actual detail access error', async () => {
    vi.mocked(fetchSourceHtml).mockImplementation(async url => {
      if (url === input.url) return '<ul class="dizin-content"><li><a href="/duyurular/ok">Haber</a></li><li><a href="/duyurular/bad">Hata</a></li></ul>'
      if (url.endsWith('/bad')) throw new Error('Kaynak HTTP 503 döndürdü.')
      return '<div class="__header"><span>11 Ekim 2026</span></div>'
    })
    expect((await scrapeSourceFeed(input)).coverageWarnings?.[0]).toContain('HTTP 503')
  })
})
