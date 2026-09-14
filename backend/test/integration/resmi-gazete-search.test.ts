import { describe, expect, it, vi } from 'vitest'
import { ResmiGazeteSearch } from '../../src/modules/scan-runs/infrastructure/resmi-gazete-search'
import { SourcePolicy } from '../../src/modules/scan-runs/domain/source-policy'

describe('ResmiGazeteSearch', () => {
  it('sends the bounded title query and resolves the matching mukerrer PDF', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{
        konu: 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ (Tebliğ No: 2018/5)’de Değişiklik Yapılmasına Dair Tebliğ',
        mevzuatAdi: 'TEBLİĞLER', resmiGazeteSayisi: 33124,
        resmiGazeteTarihiFormatted: '31.12.2025', mukerrer: 'EVET4',
        url: '/fihrist?tarih=2025-12-31&mukerrer=4',
      }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(`
        <html><body>
          <a href="unrelated.pdf">Anayasa Mahkemesi 2018/5552</a>
          <a href="20251231M4-39.pdf">İthalatta Gözetim Uygulanmasına İlişkin Tebliğ (Tebliğ No: 2018/5)’de Değişiklik</a>
        </body></html>
      `, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }))
    const gateway = new ResmiGazeteSearch(new SourcePolicy(['resmigazete.gov.tr', 'www.resmigazete.gov.tr']), { fetch: fetchFn, timeoutMs: 5_000 })

    const candidates = await gateway.search({ query: '2018/5', endDate: '2026-07-10', limit: 10 })
    const firstBody = JSON.parse(String(fetchFn.mock.calls[0]![1]?.body))
    expect(firstBody.parameters).toMatchObject({
      searchtype: '1', genelaranacakkelime: '2018/5', genelbitistarihi: '2026-07-10',
    })
    expect(candidates[0]).toMatchObject({ publicationDate: '2025-12-31', mukerrer: 'EVET4' })

    const resolved = await gateway.resolveDocumentUrl(candidates[0]!, {
      targetRegulationIdentifier: '2018/5',
      targetRegulationTitle: 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ',
    })
    expect(resolved).toBe('https://www.resmigazete.gov.tr/eskiler/2025/12/20251231M4-39.pdf')
    expect(fetchFn.mock.calls[1]![0]).toBe('https://www.resmigazete.gov.tr/eskiler/2025/12/20251231M4.htm')
  })

  it('uses the legacy HTML meta charset when the server header omits it', async () => {
    const html = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1254"></head><body><a href="20251231M4-39.pdf">İthalatta Gözetim Uygulanmasına İlişkin Tebliğ (Tebliğ No: 2018/5)</a></body></html>'
    const cp1254 = Buffer.from(html.replace(/[İıŞşĞğ]/g, (character) => String.fromCharCode(({ İ: 0xdd, ı: 0xfd, Ş: 0xde, ş: 0xfe, Ğ: 0xd0, ğ: 0xf0 } as Record<string, number>)[character]!)), 'latin1')
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(cp1254, { status: 200, headers: { 'content-type': 'text/html' } }))
    const gateway = new ResmiGazeteSearch(new SourcePolicy(['resmigazete.gov.tr', 'www.resmigazete.gov.tr']), { fetch: fetchFn, timeoutMs: 5_000 })

    await expect(gateway.resolveDocumentUrl({
      query: '2018/5', title: 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ', publicationDate: '2025-12-31',
      gazetteNo: '33124', mukerrer: 'EVET4', url: 'https://www.resmigazete.gov.tr/fihrist?tarih=2025-12-31&mukerrer=4', regulationType: 'TEBLİĞLER',
    }, { targetRegulationIdentifier: '2018/5', targetRegulationTitle: 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ' }))
      .resolves.toBe('https://www.resmigazete.gov.tr/eskiler/2025/12/20251231M4-39.pdf')
  })
})
