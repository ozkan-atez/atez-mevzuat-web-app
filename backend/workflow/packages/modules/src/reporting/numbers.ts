import { normalizeDecimal } from '../analysis/decimal'

const DATE_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g
const DATE_TR = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/

/** Analizde geçen bütün sayılar ve tarihler (rapor metnindeki sayıların izinli kümesi). */
export function allowedNumbers(source: unknown): { numbers: Set<string>; dates: Set<string> } {
  const text = JSON.stringify(source)
  const numbers = new Set<string>()
  const dates = new Set<string>()
  for (const m of text.matchAll(DATE_ISO)) dates.add(`${m[1]}-${m[2]}-${m[3]}`)
  for (const m of text.matchAll(/\d{4}\/\d+/g)) numbers.add(m[0])
  for (const m of text.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const n = normalizeDecimal(m[0])
    if (n) numbers.add(n)
    // "0,5" ↔ "0.5" ve yüzde işaretsiz biçimler
    numbers.add(m[0])
  }
  return { numbers, dates }
}

/**
 * Metin alanlarındaki sayıları analize karşı denetler (sayılar kodla eşleşmeli). Tek haneli
 * tamsayılar (madde/sıra numaraları) denetim dışıdır.
 */
export function unmatchedNumbers(texts: string[], allowed: { numbers: Set<string>; dates: Set<string> }): { checked: number; unmatched: string[] } {
  let checked = 0
  const unmatched: string[] = []
  for (const t of texts) {
    for (const m of t.matchAll(/(?<![\w])\d+(?:[.,/]\d+)*(?![\w])/g)) {
      const token = m[0]
      if (/^\d$/.test(token)) continue
      checked++
      const d = token.match(DATE_TR)
      if (d) {
        const iso = `${d[3]}-${d[2]!.padStart(2, '0')}-${d[1]!.padStart(2, '0')}`
        if (!allowed.dates.has(iso)) unmatched.push(token)
        continue
      }
      if (/^\d{4}\/\d+$/.test(token) || /^\d{4}$/.test(token)) {
        if (!allowed.numbers.has(token) && ![...allowed.dates].some((x) => x.startsWith(token))) unmatched.push(token)
        continue
      }
      const n = normalizeDecimal(token)
      if (!allowed.numbers.has(token) && !(n && allowed.numbers.has(n))) unmatched.push(token)
    }
  }
  return { checked, unmatched: [...new Set(unmatched)] }
}

/** "1234.5" → "1.234,5" (Türkçe gösterim). */
export function formatTr(value: string | null): string {
  if (value === null) return '—'
  const neg = value.startsWith('-')
  const [i, f] = (neg ? value.slice(1) : value).split('.')
  const grouped = i!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${neg ? '−' : ''}${grouped}${f ? `,${f}` : ''}`
}

export const formatDateTr = (iso: string | null) => (iso ? iso.split('-').reverse().join('.') : '—')
