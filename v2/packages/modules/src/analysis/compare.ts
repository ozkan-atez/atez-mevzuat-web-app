import type { ComparisonRow } from '@atez/contracts'
import { compareDecimal, percentChange } from './decimal'
import { normalizeCurrency, normalizeUnit } from './units'

export interface ValueRow {
  gtip: string
  description: string | null
  origin: string | null
  unit: string | null
  currency: string | null
  value: string | null
  raw: string | null
  source: string // "RG 2025/43 s.5", "TARIFF 2025-12-30" …
  note?: string | null
}

/** Önceki değer araması "önlem yoktu" dediyse (TARIFF NOT_FOUND) satır NEW olur; bilinmiyorsa NO_PRIOR. */
export interface PriorLookup {
  rows: ValueRow[]
  /** Bu GTİP(+menşe) için önceki tarihte önlem olmadığı kesin. */
  absent: Set<string>
}

export const gtipKey = (g: string) => g.replace(/\D/g, '')
const originKey = (o: string | null) => (o ?? '').trim().toLocaleUpperCase('tr')
const rowKey = (r: { gtip: string; origin: string | null }) => `${gtipKey(r.gtip)}|${originKey(r.origin)}`

/**
 * Karşılaştırma tablosu (§8): satır eşleştirme ve yüzde hesabı kodda. GTİP ve menşe ile eşleşir;
 * birim ve para birimi aynı değilse önceki değer kullanılmaz (tahmin yok).
 */
export function buildComparison(current: ValueRow[], prior: PriorLookup): { rows: ComparisonRow[]; issues: string[] } {
  const issues: string[] = []
  const priorByKey = new Map<string, ValueRow[]>()
  for (const p of prior.rows) priorByKey.set(rowKey(p), [...(priorByKey.get(rowKey(p)) ?? []), p])
  const out: ComparisonRow[] = []
  const seen = new Set<string>()
  for (const c of current) {
    const key = `${rowKey(c)}|${normalizeUnit(c.unit) ?? ''}|${normalizeCurrency(c.currency) ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const unit = normalizeUnit(c.unit)
    const currency = normalizeCurrency(c.currency)
    const candidates = (priorByKey.get(rowKey(c)) ?? []).filter((p) => p.value !== null)
    const same = candidates.filter((p) => normalizeUnit(p.unit) === unit && normalizeCurrency(p.currency) === currency)
    const base = {
      gtip: c.gtip,
      description: c.description,
      origin: c.origin,
      unit,
      currency,
      current: { value: c.value, raw: c.raw, source: c.source },
    }
    if (same.length > 1 && new Set(same.map((p) => p.value)).size > 1) {
      issues.push(`${c.gtip}${c.origin ? ` (${c.origin})` : ''}: birden fazla farklı önceki değer; kullanılmadı`)
      out.push({ ...base, previous: null, changePct: null, status: 'NO_PRIOR' })
      continue
    }
    const p = same[0]
    if (!p) {
      if (candidates.length) issues.push(`${c.gtip}${c.origin ? ` (${c.origin})` : ''}: önceki değerin birimi/para birimi farklı; kullanılmadı`)
      const absent = prior.absent.has(rowKey(c)) || prior.absent.has(`${gtipKey(c.gtip)}|`)
      out.push({ ...base, previous: null, changePct: null, status: absent ? 'NEW' : 'NO_PRIOR' })
      continue
    }
    const both = p.value !== null && c.value !== null
    out.push({
      ...base,
      previous: { value: p.value, raw: p.raw, source: p.source, note: p.note ?? null },
      changePct: both ? percentChange(p.value!, c.value!) : null,
      status: both ? (compareDecimal(p.value!, c.value!) === 0 ? 'UNCHANGED' : 'CHANGED') : 'NO_PRIOR',
    })
  }
  return { rows: out, issues }
}
