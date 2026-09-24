import { describe, expect, it } from 'vitest'
import { parseDatedFeed, parseTurkishDate } from '../../src/modules/managed-sources/source-feed-scrapers'
import { renderSourceReport } from '../../src/modules/managed-sources/source-scan-run'

describe('dated source feeds', () => {
  it('accepts only valid calendar dates', () => {
    expect(parseTurkishDate('01 Temmuz 2026')).toBe('2026-07-01')
    expect(parseTurkishDate('31.02.2026')).toBeNull()
  })
  it('filters IGMD cards to the requested date', () => {
    const html = `<div class="border-ec"><h4 class="haberbaslik"><a href="/bir_haberi">Gümrük kararı</a></h4><span class="bilgiler">21.09.2026 10:16:00</span></div><div class="border-ec"><h4 class="haberbaslik"><a href="/eski_haberi">Eski karar</a></h4><span class="bilgiler">20.09.2026</span></div>`
    expect(parseDatedFeed('IGMD_MEVZUAT', html, 'https://www.igmd.org.tr/mevzuat_haberleri', '2026-09-21', 'igmd')).toMatchObject([{ title: 'Gümrük kararı', publishedOn: '2026-09-21' }])
  })
  it('rejects an external link in a dated commercial feed', () => {
    const html = `<table><tr><td></td><td>21.09.2026</td><td></td><td><a href="https://other.example/file">Başlık</a></td></tr></table>`
    expect(parseDatedFeed('MEVZUAT_GUNCELLIK', html, 'https://www.mevzuat.net/Guncellik.aspx', '2026-09-21', 'mevzuat-net')).toEqual([])
  })
  it('does not create a report when the source has no changes', async () => {
    await expect(renderSourceReport({ sourceName: 'Site', sourceType: 'OFFICIAL', sourceUrl: 'https://example.org/', targetDate: '2026-09-21', documents: [], failures: [] })).resolves.toBeNull()
  })
  it('uses the shared bulletin template and escapes source text', async () => {
    const html = await renderSourceReport({ sourceName: 'Site', sourceType: 'OFFICIAL', sourceUrl: 'https://example.org/', targetDate: '2026-09-21', documents: [{ title: '<script>x</script>', url: 'https://example.org/item', contentText: '<img src=x>' }], failures: [] })
    expect(html).toContain('ATEZ Mevzuat Radarı Günlük Raporu')
    expect(html).toContain('bulten')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;img src=x&gt;')
  })
})
