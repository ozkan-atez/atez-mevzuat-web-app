import { normalizeDecimal } from './decimal'

/** Birim ve para birimi eşleştirmesi (karşılaştırmada birebir eşleşme şartı, §8). */
const CURRENCY: [RegExp, string][] = [
  [/^(usd|abd ?dolar[ıi]?|dolar|\$)$/i, 'USD'],
  [/^(eur|avro|euro|€)$/i, 'EUR'],
  [/^(try|tl|türk lirası|₺)$/i, 'TRY'],
  [/^(gbp|sterlin)$/i, 'GBP'],
  [/^(jpy|yen)$/i, 'JPY'],
]
const UNIT: [RegExp, string][] = [
  [/^(%|yüzde|pct|percent)$/i, 'PCT'],
  [/^(ton|tne|1000 ?kg|1 ?ton|brüt ton)$/i, 'TNE'],
  [/^(kg|kgm|kilogram|brüt kg|kg brüt)$/i, 'KGM'],
  [/^(adet|pce|unit|çift|nar)$/i, 'PCE'],
  [/^(m2|m²|mtk|metrekare)$/i, 'MTK'],
  [/^(lt|l|ltr|litre)$/i, 'LTR'],
]

export function normalizeCurrency(v: string | null | undefined): string | null {
  if (!v) return null
  const s = v.trim()
  for (const [re, c] of CURRENCY) if (re.test(s)) return c
  return s.toUpperCase()
}

export function normalizeUnit(v: string | null | undefined): string | null {
  if (!v) return null
  const s = v.trim().replace(/^\//, '').replace(/\s+/g, ' ')
  for (const [re, u] of UNIT) if (re.test(s)) return u
  return s.toUpperCase()
}

/** "5,500.00 USD / 1000 kg", "20 %", "%20" gibi sağlayıcı değerlerini ayrıştırır. Aralıklar tek değer değildir. */
export function parseProviderValue(raw: string | null | undefined): { value: string | null; currency: string | null; unit: string | null } {
  if (!raw) return { value: null, currency: null, unit: null }
  const s = raw.trim()
  if (/\d\s*%?\s*-\s*\d/.test(s.replace(/^-/, ''))) return { value: null, currency: null, unit: null }
  const pct = s.match(/^%\s*([\d.,]+)$|^([\d.,]+)\s*%$/)
  if (pct) return { value: normalizeOrNull(pct[1] ?? pct[2]!), currency: null, unit: 'PCT' }
  const m = s.match(/^([\d.,]+)\s*([A-Za-zÇĞİÖŞÜçğıöşü$€₺]+)?\s*(?:\/\s*(.+))?$/)
  if (!m) return { value: null, currency: null, unit: null }
  return { value: normalizeOrNull(m[1]!), currency: normalizeCurrency(m[2] ?? null), unit: normalizeUnit(m[3] ?? null) }
}

const normalizeOrNull = (v: string) => normalizeDecimal(v)
