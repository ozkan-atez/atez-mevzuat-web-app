import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDatedFeed, parseTurkishDate, readSourceItem, scrapeSourceFeed } from '../../src/modules/managed-sources/source-feed-scrapers'

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
})

vi.mock('../../src/modules/managed-sources/tariff-auth', () => ({
  getTariffAccessToken: vi.fn(async () => 'test-access-token'), clearTariffToken: vi.fn(),
}))
const feedUrl = 'https://tariff.singlewindow.io/legislation-news'
const credentials = { username: 'test-user', password: 'test-password' }
const notification = (messages: unknown[]) => ({ event_code: 'event-1', created_at: '2026-10-08T09:00:00Z', username: 'PRIVATE_ACCOUNT', notification_messages: messages })
afterEach(() => vi.unstubAllGlobals())
describe('authenticated Tariff notification evidence', () => {
  it('reads actual records payload, prefers Turkish body and retains original evidence links', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ records: [notification([
      { title: 'English title', language_code: 'en', formatted_text: '<p>English body</p>' },
      { title: 'İthalat gözetim değişikliği', language_code: 'tr', formatted_text: '<p>Gözetim uygulaması 8 Ekim tarihinde yürürlüğe girer.</p><a href="https://www.resmigazete.gov.tr/eskiler/2026/10/20261008.htm">Resmî metin</a><script>UNTRUSTED_SCRIPT</script>' },
    ])], total: 1, page: 1, pageSize: 10 })))
    vi.stubGlobal('fetch', fetcher)
    const items = await scrapeSourceFeed({ adapter: 'TARIFF_API', url: feedUrl, sourceKey: 'tariff', targetDate: '2026-10-08', credentials })
    expect(items).toHaveLength(1)
    expect(items[0]?.title).toBe('İthalat gözetim değişikliği')
    const content = await readSourceItem(items[0]!, 'TARIFF_API', credentials)
    expect(content).toContain('Gözetim uygulaması 8 Ekim tarihinde yürürlüğe girer.')
    expect(content).toContain('https://www.resmigazete.gov.tr/eskiler/2026/10/20261008.htm')
    expect(content).toContain('Bildirim bağlantısı: https://tariff.singlewindow.io/legislation-news?eventCode=event-1')
    expect(content).not.toMatch(/PRIVATE_ACCOUNT|test-access-token|UNTRUSTED_SCRIPT|English body/)
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('notification-details/all'), expect.objectContaining({ headers: { Authorization: 'Bearer test-access-token' } }))
  })
  it('rejects title-only notifications instead of turning their titles into report evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ records: [notification([{ title: 'Başlık', language_code: 'tr', formatted_text: '<h1>Başlık</h1>' }])] }))))
    const items = await scrapeSourceFeed({ adapter: 'TARIFF_API', url: feedUrl, sourceKey: 'tariff', targetDate: '2026-10-08', credentials })
    expect(items[0]?.capturedContent).toBeNull()
    await expect(readSourceItem(items[0]!, 'TARIFF_API', credentials)).rejects.toThrow('yalnızca başlıktan')
  })
  it('reacquires missing legacy bodies via the known authenticated API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [notification([{ title: 'Gözetim', language_code: 'tr', formatted_text: '<p>İlgili ürün için ilave yükümlülük uygulanır.</p>' }])] }))))
    const content = await readSourceItem({ title: 'Gözetim', url: `${feedUrl}?eventCode=event-1`, feedUrl, publishedOn: '2026-10-08' }, 'TARIFF_API', credentials)
    expect(content).toContain('İlgili ürün için ilave yükümlülük uygulanır.')
  })
  it('rejects unexpected response structures rather than reporting a false empty day', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ unexpected: [] }))))
    await expect(scrapeSourceFeed({ adapter: 'TARIFF_API', url: feedUrl, sourceKey: 'tariff', targetDate: '2026-10-08', credentials })).rejects.toThrow('beklenen kayıt biçiminde')
  })
  it('reads authenticated later pages instead of treating an incomplete first page as the whole feed', async () => {
    const first = notification([{ title: 'İlk bildirim', language_code: 'tr', formatted_text: '<p>İlk düzenleme gümrük işlemlerini değiştirir.</p>' }])
    const second = { ...notification([{ title: 'İkinci bildirim', language_code: 'tr', formatted_text: '<p>İkinci düzenleme ithalat şartlarını değiştirir.</p>' }]), event_code: 'event-2' }
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ records: [first], total: 2, page: 1, pageSize: 1 }))).mockResolvedValueOnce(new Response(JSON.stringify({ records: [second], total: 2, page: 2, pageSize: 1 })))
    vi.stubGlobal('fetch', fetcher)
    const items = await scrapeSourceFeed({ adapter: 'TARIFF_API', url: feedUrl, sourceKey: 'tariff', targetDate: '2026-10-08', credentials })
    expect(items).toHaveLength(2)
    expect(items[1]?.capturedContent).toContain('İkinci düzenleme ithalat şartlarını değiştirir.')
    expect(fetcher.mock.calls[1]?.[0]).toContain('page=2')
  })
  it('bounds captured body text and ignores nonmatching publication dates', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ records: [notification([{ title: 'Gözetim', language_code: 'tr', formatted_text: '<p>'+ 'Kanıt metni '.repeat(10000) + '</p>' }]), { ...notification([]), created_at: '2026-10-07' }] }))))
    const items = await scrapeSourceFeed({ adapter: 'TARIFF_API', url: feedUrl, sourceKey: 'tariff', targetDate: '2026-10-08', credentials })
    expect(items).toHaveLength(1)
    expect(items[0]?.capturedContent!.length).toBeLessThan(80500)
  })
})

describe('generic and ministry feed regressions',()=>{
 it('supports generic article dates and time metadata',()=>{
  const items=parseDatedFeed('GENERIC','<article><time datetime="2026-10-10"></time><a href="/news/1">İthalat duyurusu</a></article>','https://example.com/feed','2026-10-10','custom-example')
  expect(items).toHaveLength(1)
 })
 it('handles the ministry duplicate-dot date and captures every annex in the same row',()=>{
  const items=parseDatedFeed('TICARET_GENELGE','<table><tr><td>Diplomatik İşlemler</td><td>2026/11</td><td>05.10..2026</td><td><a href="/main.pdf?download=1">Detay</a><a href="/annex.pdf">Ek</a><a href="/annex.xlsx">Çizelge</a></td></tr></table>','https://ticaret.gov.tr/genelge/2026','2026-10-05','ticaret-bakanligi')
  expect(items).toHaveLength(1);expect(items[0]?.attachments).toHaveLength(2)
 })
})
