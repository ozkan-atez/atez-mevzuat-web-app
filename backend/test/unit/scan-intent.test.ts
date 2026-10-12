import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { parseScanIntent } from '../../src/modules/chat/application/scan-intent'

const now = DateTime.fromISO('2026-09-21T13:00:00', { zone: 'Europe/Istanbul' })

describe('chat scan intent', () => {
  it('resolves a requested past date and today', () => {
    expect(parseScanIntent('28 Temmuz için yeni tarama ve rapor oluştur', now)).toEqual({ targetDate: '2026-07-28' })
    expect(parseScanIntent('28.07.2026 taramasını başlatır mısın?', now)).toEqual({ targetDate: '2026-07-28' })
    expect(parseScanIntent('Bugünün mevzuat taramasını başlat', now)).toEqual({ targetDate: '2026-09-21' })
    expect(parseScanIntent('28 Temmuz raporunu hazırla', now)).toEqual({ targetDate: '2026-07-28' })
  })

  it('does not run for lookups or quoted inability statements', () => {
    expect(parseScanIntent('28 Temmuz taraması var mı?', now)).toBeNull()
    expect(parseScanIntent('28 Temmuz raporunu getir', now)).toBeNull()
    expect(parseScanIntent('Yeni bir tarama başlatma yetkim yok, manuel olarak başlatabilirsiniz.', now)).toBeNull()
    expect(parseScanIntent('28 Temmuz taramasını başlattın mı?', now)).toBeNull()
    expect(parseScanIntent('28 Temmuz taramasını başlatma.', now)).toBeNull()
  })

  it('rejects impossible dates', () => {
    expect(parseScanIntent('31 Şubat 2026 tarama başlat', now)).toEqual({ error: 'Geçerli bir tarama tarihi belirtin.' })
  })
})
