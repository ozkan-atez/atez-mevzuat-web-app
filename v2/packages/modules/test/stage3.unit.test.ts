import { describe, expect, it } from 'vitest'
import {
  allowedNumbers,
  buildComparison,
  containsNumber,
  decideHit,
  formatTr,
  normalizeDecimal,
  parseProviderValue,
  percentChange,
  scoreHits,
  selectTariffMeasure,
  unmatchedNumbers,
  type RgSearchHit,
} from '../src/index'

describe('ondalık ve değer ayrıştırma (§7)', () => {
  it('Türkçe ve İngilizce biçimler, binlik kuralı', () => {
    expect(normalizeDecimal('1.250,50')).toBe('1250.5')
    expect(normalizeDecimal('5,500.00')).toBe('5500')
    expect(normalizeDecimal('4.500')).toBe('4500') // tek ayırıcı + 3 hane = binlik
    expect(normalizeDecimal('0,5')).toBe('0.5')
    expect(normalizeDecimal('%20')).toBe('20')
    expect(normalizeDecimal('1.2.3')).toBeNull()
    expect(normalizeDecimal('serbest')).toBeNull()
  })
  it('yüzde değişim kodla, iki ondalık', () => {
    expect(percentChange('400', '500')).toBe('25.00')
    expect(percentChange('3', '2')).toBe('-33.33')
    expect(percentChange('0', '5')).toBeNull()
  })
  it('sağlayıcı değeri: tutar/birim, yüzde; aralık tek değer değildir', () => {
    expect(parseProviderValue('5,500.00 USD / 1000 kg')).toEqual({ value: '5500', currency: 'USD', unit: 'TNE' })
    expect(parseProviderValue('20.00 %')).toEqual({ value: '20', currency: null, unit: 'PCT' })
    expect(parseProviderValue('0.00 % - 57.11 %').value).toBeNull()
  })
  it('Türkçe gösterim', () => {
    expect(formatTr('1250.5')).toBe('1.250,5')
    expect(formatTr('-12.00')).toBe('−12,00')
  })
})

const measure = (o: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  measureType: { measure_type_code: 'TR059' },
  effective_start_date: '2025-01-01',
  effective_end_date: '4000-01-01',
  is_import: true,
  areaDetails: [{ geographical_area_code: '1011' }],
  base_duty_formatted: '20.00 %',
  legalActViews: [],
  ...o,
})
const payload = (measures: unknown[]) => ({ measures, commodities: [{ commodity_code: '720851200011', declarable: true, commodity_start_date: '2000-01-01', commodity_end_date: null }] })

describe('TARIFF kesin seçim (Ek B.2)', () => {
  const req = { gtip: '720851200011', date: '2025-12-30', field: 'ILAVE_GUMRUK_VERGISI' as const, origin: null }
  it('tek erga omnes önlem → FOUND', () => {
    expect(selectTariffMeasure(payload([measure()]), req)).toMatchObject({ status: 'FOUND', value: '20', unit: 'PCT' })
  })
  it('kısa GTİP sıfırla doldurulmaz', () => {
    expect(selectTariffMeasure(payload([measure()]), { ...req, gtip: '7208' }).status).toBe('NEEDS_CODE_EXPANSION')
  })
  it('önlemin kendi penceresi: ertesi gün başlayan önlem sayılmaz → NOT_FOUND ("önlem yoktu")', () => {
    expect(selectTariffMeasure(payload([measure({ effective_start_date: '2025-12-31' })]), req).status).toBe('NOT_FOUND')
  })
  it('menşe verilmemişse birden çok aday → AMBIGUOUS; menşe birebir → FOUND', () => {
    const two = payload([measure({ id: 1, areaDetails: [{ geographical_area_code: 'CN' }] }), measure({ id: 2, areaDetails: [{ geographical_area_code: 'VN' }], base_duty_formatted: '30.00 %' })])
    expect(selectTariffMeasure(two, req).status).toBe('AMBIGUOUS')
    expect(selectTariffMeasure(two, { ...req, origin: 'VN' })).toMatchObject({ status: 'FOUND', value: '30' })
  })
  it('birim/para birimi uyuşmazsa değer kullanılmaz', () => {
    const p = payload([measure({ measureType: { measure_type_code: 'TRC057' }, base_duty_formatted: '5,500.00 USD / 1000 kg' })])
    const r = selectTariffMeasure(p, { ...req, field: 'GOZETIM_DEGERI', expected: { unit: 'kg', currency: 'ABD Doları' } })
    expect(r).toMatchObject({ status: 'PARTIAL', value: null })
    expect(selectTariffMeasure(p, { ...req, field: 'GOZETIM_DEGERI', expected: { unit: 'ton', currency: 'ABD Doları' } })).toMatchObject({ status: 'FOUND', value: '5500' })
  })
  it('askıda/silinmiş ya da ithalat dışı önlem seçilmez', () => {
    expect(selectTariffMeasure(payload([measure({ isSuspended: true })]), req).status).toBe('NOT_FOUND')
    expect(selectTariffMeasure(payload([measure({ is_import: false })]), req).status).toBe('NOT_FOUND')
  })
})

describe('RG araması puanlama', () => {
  const hit = (title: string, date: string, number: string | null = null): RgSearchHit => ({ title, date, issue: '1', mukerrer: null, number, kind: null, indexUrl: `https://www.resmigazete.gov.tr/fihrist?tarih=${date}` })
  it('2018/5 ile 2018/5552 karışmaz', () => {
    expect(containsNumber('Tebliğ (No: 2018/5552)', '2018/5')).toBe(false)
    expect(containsNumber('Tebliğ (No: 2018/5)', '2018/5')).toBe(true)
    expect(containsNumber('Tebliğ (Tebliğ No: 2018/5)’de', '2018/5')).toBe(true)
  })
  it('numara + başlık eşleşen en yeni aday seçilir; mevcut belge hariç', () => {
    const hits = [
      hit('İthalatta Gözetim Uygulanmasına İlişkin Tebliğ (Tebliğ No: 2018/5552)', '2024-01-01'),
      hit('İthalatta Gözetim Uygulanmasına İlişkin Tebliğ (Tebliğ No: 2018/5)', '2018-03-01'),
      hit('İthalatta Gözetim Uygulanmasına İlişkin Tebliğ (Tebliğ No: 2018/5)’de Değişiklik Yapılmasına Dair Tebliğ', '2023-06-01'),
    ]
    const scored = scoreHits(hits, [{ title: 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ', number: '2018/5' }], { title: 'Yeni değişiklik', date: '2025-12-31' })
    expect(scored.map((s) => s.date)).toEqual(['2023-06-01', '2018-03-01', '2024-01-01'])
    expect(decideHit(scored).chosen?.date).toBe('2023-06-01')
  })
  it('başka türde aynı numara (Anayasa Mahkemesi "E: 2018/1") tek başına seçilmez', () => {
    const scored = scoreHits(
      [hit('Anayasa Mahkemesinin 4/3/2021 Tarihli ve E: 2018/1 (Siyasi Parti Mali Denetimi), K: 2021/76 Sayılı Kararı', '2021-04-09'), hit('İthalatta Gözetim Uygulanmasına İlişkin Tebliğ (Tebliğ No: 2018/1)', '2018-01-10')],
      [{ title: 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ (Tebliğ No: 2018/1)', number: '2018/1' }],
      { title: 'x', date: '2025-12-31' },
    )
    expect(decideHit(scored).chosen?.date).toBe('2018-01-10')
  })
  it('numara eşleşmesi yoksa belirsiz', () => {
    const scored = scoreHits([hit('İthalatta Gözetim Uygulanmasına İlişkin Tebliğ', '2020-01-01')], [{ title: 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ', number: '2018/5' }], { title: 'x', date: '2025-12-31' })
    expect(decideHit(scored)).toEqual({ chosen: null, ambiguous: true })
  })
})

describe('karşılaştırma tablosu (kod)', () => {
  const row = (o: Record<string, unknown>) => ({ gtip: '7208.51.20.00.11', description: 'Sac', origin: 'CN', unit: 'ton', currency: 'ABD Doları', value: '500', raw: '500', source: 'd1', ...o })
  it('GTİP + menşe + birim + para birimi eşleşmesi, yüzde', () => {
    const r = buildComparison([row({})], { rows: [row({ gtip: '720851200011', value: '400', unit: '1000 kg', currency: 'USD', source: 't1' })], absent: new Set() })
    expect(r.rows[0]).toMatchObject({ status: 'CHANGED', changePct: '25.00', previous: { value: '400' } })
  })
  it('birim farklıysa önceki değer kullanılmaz; önlem yoktuysa NEW', () => {
    const r = buildComparison([row({}), row({ origin: 'VN' })], { rows: [row({ value: '400', unit: 'kg' })], absent: new Set(['720851200011|VN']) })
    expect(r.rows.map((x) => x.status)).toEqual(['NO_PRIOR', 'NEW'])
    expect(r.issues[0]).toMatch(/birimi/)
  })
})

describe('rapor sayı denetimi', () => {
  const allowed = allowedNumbers({ a: '1250.5', d: '2025-12-31', n: '2018/5', pct: '25.00' })
  it('analizde olmayan sayıyı yakalar, tarih ve numaraları tanır', () => {
    const r = unmatchedNumbers(['Değer 1.250,5 olarak 31.12.2025 tarihinde değişti; 2018/5 tebliği; artış %25,00', 'Uydurma 999,9 ve 3 madde'], allowed)
    expect(r.unmatched).toEqual(['999,9'])
  })
})

import { GifWriter } from 'omggif'
import { PNG } from 'pngjs'
import { gifToPng } from '../src/index'

describe('GIF → PNG biçim dönüşümü', () => {
  it('pikselleri aynen taşır', () => {
    const buf = Buffer.alloc(1024)
    const w = new GifWriter(buf, 2, 1, { palette: [0xff0000, 0x0000ff] })
    w.addFrame(0, 0, 2, 1, [0, 1])
    const png = PNG.sync.read(gifToPng(buf.subarray(0, w.end())))
    expect([png.width, png.height]).toEqual([2, 1])
    expect([...png.data.subarray(0, 8)]).toEqual([255, 0, 0, 255, 0, 0, 255, 255])
  })
})
