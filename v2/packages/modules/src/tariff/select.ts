import { parseProviderValue, normalizeCurrency, normalizeUnit } from '../analysis/units'
import type { TariffField } from '@atez/contracts'
import type { z } from 'zod'

type Field = z.infer<typeof TariffField>
type Row = Record<string, any>

/** Alan → önlem tipi kodları (§7 tablosu). `*` önek eşlemesi. */
export const FIELD_MEASURE_CODES: Record<Field, string[]> = {
  GOZETIM_DEGERI: ['TRC057', 'TRC018', 'TRC105'],
  DAMPING: ['TR020*', 'TR032*'],
  ILAVE_GUMRUK_VERGISI: ['TR059'],
  GUMRUK_VERGISI: ['103', '106', '142'],
  EK_MALI_YUKUMLULUK: ['TR392', 'TR394'],
  KDV: ['TR040'],
  DIGER: [],
}

export type TariffSelectStatus = 'FOUND' | 'PARTIAL' | 'NOT_FOUND' | 'AMBIGUOUS' | 'ERROR' | 'NEEDS_CODE_EXPANSION'

export interface TariffSelection {
  status: TariffSelectStatus
  measureId: string | number | null
  typeCode: string | null
  rawValue: string | null
  value: string | null
  currency: string | null
  unit: string | null
  origin: string | null
  effectiveFrom: string | null
  effectiveTo: string | null
  legalSources: string[]
  issues: string[]
}

const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [])
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)
const OPEN_END = '4000-01-01'

/** Önlemin kendi penceresine göre o gün geçerli mi? (`queryDate` yanıtı filtrelemez, §7) */
export function activeOn(row: Row, date: string, start: string, end: string): boolean {
  const from = day(row[start])
  const to = day(row[end])
  if (!from || from > date) return false
  return row[end] == null || to === OPEN_END || (!!to && to >= date)
}

const codeMatches = (code: string, patterns: string[]) => patterns.some((p) => (p.endsWith('*') ? code.startsWith(p.slice(0, -1)) : code === p))

/**
 * Kesin seçim kuralları (Ek B.2, dalın `tariff-retrieval.ts`): 12 haneli beyan edilebilir aktif kod;
 * önlem `is_import`, askıda/silinmiş değil; menşe birebir (verilmemişse yalnız tek `1011`);
 * yasal referans `regulation_code` ile eşleşmeli; birim ve para birimi aynı olmalı. Uymayan cevap
 * tahminle doldurulmaz.
 */
export function selectTariffMeasure(
  raw: unknown,
  req: { gtip: string; date: string; field: Field; origin: string | null; legalReferences?: string[]; expected?: { unit: string | null; currency: string | null } },
): TariffSelection {
  const base: TariffSelection = { status: 'NOT_FOUND', measureId: null, typeCode: null, rawValue: null, value: null, currency: null, unit: null, origin: req.origin, effectiveFrom: null, effectiveTo: null, legalSources: [], issues: [] }
  if (!/^\d{12}$/.test(req.gtip)) return { ...base, status: 'NEEDS_CODE_EXPANSION', issues: ['Kısa GTİP sıfırla doldurulmaz'] }
  const payload = raw as Row
  if (!payload || !Array.isArray(payload.measures)) return { ...base, status: 'ERROR', issues: ['Geçersiz TARIFF yanıtı (measures yok)'] }
  const patterns = FIELD_MEASURE_CODES[req.field]
  if (!patterns.length) return { ...base, status: 'AMBIGUOUS', issues: ['Alan için doğrulanmış önlem tipi kodu yok'] }

  const commodities = rows(payload.commodities).filter((c) => c.commodity_code === req.gtip && c.declarable === true && activeOn(c, req.date, 'commodity_start_date', 'commodity_end_date'))
  if (Array.isArray(payload.commodities) && commodities.length !== 1) base.issues.push('Seçilen tarihte tekil, beyan edilebilir ürün kimliği doğrulanamadı')

  const candidates = rows(payload.measures).filter(
    (m) =>
      codeMatches(String(m.measureType?.measure_type_code ?? ''), patterns) &&
      activeOn(m, req.date, 'effective_start_date', 'effective_end_date') &&
      m.is_import === true &&
      !m.isSuspended &&
      !m.was_deleted &&
      !m.deleted_at,
  )
  const scope = (m: Row) => rows(Array.isArray(m.areaDetails) ? m.areaDetails : [m.areaDetails]).map((a) => String(a.geographical_area_code ?? ''))
  const selected = req.origin ? candidates.filter((m) => scope(m).includes(req.origin!)) : candidates.length === 1 && scope(candidates[0]!).includes('1011') ? candidates : []
  if (candidates.length === 0) return { ...base, issues: [...base.issues, 'O tarihte bu tipte önlem yok'] } // "önlem yoktu" — NOT_FOUND
  if (selected.length !== 1) return { ...base, status: 'AMBIGUOUS', issues: [...base.issues, 'Ülke/grup veya birden fazla önlem kesin eşleştirilemedi'] }
  if (Array.isArray(payload.commodities) && commodities.length !== 1) return { ...base, status: 'AMBIGUOUS' }

  const m = selected[0]!
  const urls: string[] = rows(m.legalActViews).map((a) => String(a.regulation_url ?? '')).filter((u) => /^https?:\/\//.test(u))
  const legalSources = [...new Set(urls)]
  if (req.legalReferences?.length) {
    const refs: string[] = rows(m.legalActViews).map((a) => String(a.regulation_code ?? '')).join(' ').match(/\b\d{4}\/\d+\b/g) ?? []
    if (!req.legalReferences.some((r) => refs.includes(r))) return { ...base, status: 'AMBIGUOUS', legalSources, issues: [...base.issues, 'Temel mevzuat numarası sağlayıcı kaydında eşleşmedi'] }
  }
  const rawValue = typeof m.base_duty_formatted === 'string' ? m.base_duty_formatted : typeof m.base_duty === 'string' ? m.base_duty : null
  const parsed = parseProviderValue(rawValue)
  const out: TariffSelection = {
    ...base,
    status: 'FOUND',
    measureId: m.id ?? null,
    typeCode: String(m.measureType?.measure_type_code ?? ''),
    rawValue,
    value: parsed.value,
    currency: parsed.currency,
    unit: parsed.unit,
    effectiveFrom: day(m.effective_start_date),
    effectiveTo: day(m.effective_end_date),
    legalSources,
  }
  if (!parsed.value) return { ...out, status: 'PARTIAL', issues: [...out.issues, 'Değer tek bir sayı olarak okunamadı (aralık veya firma bazlı oran olabilir)'] }
  if (req.expected) {
    const eu = normalizeUnit(req.expected.unit)
    const ec = normalizeCurrency(req.expected.currency)
    if ((eu && out.unit && eu !== out.unit) || (ec && out.currency && ec !== out.currency) || (ec && !out.currency) || (eu && !out.unit)) {
      return { ...out, status: 'PARTIAL', value: null, issues: [...out.issues, `Birim/para birimi eşleşmedi (beklenen ${ec ?? '-'} / ${eu ?? '-'}, TARIFF ${out.currency ?? '-'} / ${out.unit ?? '-'})`] }
    }
  }
  return out
}
