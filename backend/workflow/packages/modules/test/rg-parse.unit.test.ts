import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDayPage, parseFihristPage } from '../src/sources/resmi-gazete/parse'

const fx = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/rg/${name}`, import.meta.url)), 'utf8')

describe('RG günlük sayfa ve #sonMukerrerContainer kuralı (§9.1)', () => {
  it('15.10.2026: mükerrer yok', () => {
    const day = parseDayPage(fx('day-2026-10-15.html'), '2026-10-15')
    expect(day.mukerrer).toEqual([])
    expect(day.badgeCount).toBe(0)
    expect(day.items.length).toBeGreaterThan(5)
  })

  it('06.09.2026: tek mükerrer butonu (a#sonMukerrerBtn)', () => {
    const day = parseDayPage(fx('day-2026-09-06.html'), '2026-09-06')
    expect(day.issue).toBe('33362')
    expect(day.mukerrer).toEqual([{ n: 1, url: 'https://www.resmigazete.gov.tr/fihrist?tarih=2026-09-06&mukerrer=1' }])
    expect(day.items.map((i) => [i.kind, i.title.slice(0, 30)])).toEqual([
      ['REGULATION', 'Türkiye Uluslararası İslam, Bi'],
      ['REGULATION', 'Ulusal Meslek Standartlarına D'],
      ['REGULATION', 'Ulusal Meslek Standartlarına D'],
      ['ANNOUNCEMENT', 'a - Artırma, Eksiltme ve İhale'],
      ['ANNOUNCEMENT', 'b - Çeşitli İlânlar'],
      ['ANNOUNCEMENT', 'T.C. Merkez Bankasınca Belirle'],
    ])
  })

  it('31.12.2025: 6 mükerrerli açılır menü, bölüm ve tür bağlamı', () => {
    const day = parseDayPage(fx('day-2025-12-31.html'), '2025-12-31')
    expect(day.issue).toBe('33124')
    expect(day.badgeCount).toBe(6)
    expect(day.mukerrer.map((m) => m.n)).toEqual([1, 2, 3, 4, 5, 6])
    const first = day.items[0]!
    expect(first).toMatchObject({ rgSection: 'YÜRÜTME VE İDARE BÖLÜMÜ', rgType: 'MİLLETLERARASI ANDLAŞMA', mukerrer: null, position: 0 })
    expect(first.canonicalKey).toBe('rg:eskiler/2025/12/20251231-29.pdf')
    // Mükerrer çapraz bağlantıları belge olarak alınmaz
    expect(day.items.some((i) => i.url.includes('/fihrist'))).toBe(false)
  })

  it('mükerrer fihristi (3. mükerrer: İthalat Rejimi Kararı ve tebliğler)', () => {
    const page = parseFihristPage(fx('fihrist-2025-12-31-m3.html'), '2025-12-31', 3)
    expect(page.issue).toBe('33124')
    expect(page.items[0]).toMatchObject({
      url: 'https://www.resmigazete.gov.tr/eskiler/2025/12/20251231M3-1.pdf',
      title: 'İthalat Rejimi Kararında Değişiklik Yapılmasına İlişkin Karar (Karar Sayısı: 10790)',
      mukerrer: 3,
      rgType: 'CUMHURBAŞKANI KARARLARI',
    })
    expect(page.items).toHaveLength(28)
  })

  it('yanlış güne ait sayfayı reddeder', () => {
    expect(() => parseDayPage(fx('day-2025-12-31.html'), '2025-12-30')).toThrow(/ait değil/)
  })
})
