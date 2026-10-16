import { clearTariffToken, getTariffAccessToken, type TariffCredentials } from '../managed-sources/tariff-auth'

const API = 'https://tariff.singlewindow.io/api/v2-0/tariff-query/tariff-measures-by-commodity'
const MCP = 'https://tariff.singlewindow.io/api/v1-0/mcp'
const MAX_RESPONSE_BYTES = 4_000_000
const DATE = /^\d{4}-\d{2}-\d{2}$/

export interface TariffMeasure {
  typeCode: string
  typeName: string | null
  origin: string | null
  value: string | null
  rates: string[]
  effectiveFrom: string | null
  effectiveTo: string | null
  regulationUrls: string[]
}

export interface TariffComparison {
  typeCode: string
  typeName: string | null
  origin: string | null
  current: TariffMeasure[]
  previous: TariffMeasure[] | null
  previousDate: string | null
  status: 'changed' | 'new' | 'withdrawn' | 'unchanged' | 'unknown'
}

export interface TariffLookupResult {
  code: string
  date: string
  description: string | null
  source: string
  fetchedAt: string
  classification: 'SUPPORTING_NON_AUTHORITATIVE'
  comparisons: TariffComparison[]
  notes: string[]
}

export function normalizeGtip(value: string): string {
  if (!/^(?:\d{6}(?:\d{2}){0,3}|\d{4}(?:[.\s]\d{2}){1,4})$/.test(value.trim())) throw new Error('GTİP 6, 8, 10 veya 12 rakam olmalıdır.')
  const digits = value.replace(/\D/g, '')
  if (digits.length < 6 || digits.length > 12) throw new Error('GTİP 6, 8, 10 veya 12 rakam olmalıdır.')
  return digits.padEnd(12, '0')
}

export function validTariffDate(value: string): boolean {
  return DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

export function parseTariffMeasures(payload: unknown): TariffMeasure[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray(Reflect.get(payload, 'measures'))) throw new Error('Tariff önlem yanıtı beklenen biçimde değil.')
  return (Reflect.get(payload, 'measures') as unknown[]).flatMap((raw): TariffMeasure[] => {
    if (!raw || typeof raw !== 'object') return []
    const row = raw as Record<string, unknown>
    const kind = row.measureType && typeof row.measureType === 'object' ? row.measureType as Record<string, unknown> : {}
    const area = Array.isArray(row.areaDetails) ? row.areaDetails[0] : row.areaDetails
    const origin = area && typeof area === 'object' ? str((area as Record<string, unknown>).geographical_area_code) : null
    const rates = Array.isArray(row.conditions) ? [...new Set(row.conditions.flatMap((condition): string[] => {
      const rate = condition && typeof condition === 'object' ? str((condition as Record<string, unknown>).duty_expression) : null
      return rate ? [rate] : []
    }))] : []
    const regulationUrls = Array.isArray(row.legalActViews) ? [...new Set(row.legalActViews.flatMap((act): string[] => {
      const url = act && typeof act === 'object' ? str((act as Record<string, unknown>).regulation_url) : null
      return url && /^https?:\/\//.test(url) ? [url] : []
    }))] : []
    return [{
      typeCode: str(kind.measure_type_code) ?? 'UNKNOWN', typeName: str(kind.measure_type_description), origin,
      value: str(row.base_duty_formatted) ?? str(row.base_duty), rates,
      effectiveFrom: str(row.effective_start_date), effectiveTo: str(row.effective_end_date), regulationUrls,
    }]
  })
}

export function inForceOn(measures: TariffMeasure[], date: string): TariffMeasure[] {
  return measures.filter((measure) => (!measure.effectiveFrom || measure.effectiveFrom <= date)
    && (!measure.effectiveTo || measure.effectiveTo === '4000-01-01' || measure.effectiveTo >= date))
}

export interface TariffLookup {
  lookup(input: { code: string; date: string; previousDate?: string; origin?: string; compare?: boolean }): Promise<TariffLookupResult>
}

export class SingleWindowTariffLookup implements TariffLookup {
  constructor(private readonly credentials: TariffCredentials, private readonly fetcher: typeof fetch = fetch) {}

  async lookup(input: { code: string; date: string; previousDate?: string; origin?: string; compare?: boolean }): Promise<TariffLookupResult> {
    const code = normalizeGtip(input.code)
    if (!validTariffDate(input.date) || (input.previousDate && !validTariffDate(input.previousDate))) throw new Error('Geçerli bir YYYY-AA-GG tarihi girin.')
    const source = `${API}?${new URLSearchParams({ commodityCode: code, countryCode: 'TR', queryType: 'import', queryDate: input.date })}`
    const [currentPayload, description] = await Promise.all([this.readMeasures(source), this.readDescription(code).catch(() => null)])
    const current = inForceOn(parseTariffMeasures(currentPayload), input.date).filter((item) => !input.origin || item.origin === input.origin.toUpperCase())
    const groups = new Map<string, TariffMeasure[]>()
    for (const measure of current) {
      const key = `${measure.typeCode}|${measure.origin ?? ''}`
      groups.set(key, [...(groups.get(key) ?? []), measure])
    }
    if (input.compare === false) {
      return { code, date: input.date, description, source, fetchedAt: new Date().toISOString(), classification: 'SUPPORTING_NON_AUTHORITATIVE',
        comparisons: [...groups.values()].map(group => ({ typeCode: group[0]!.typeCode, typeName: group[0]!.typeName, origin: group[0]!.origin,
          current: group, previous: null, previousDate: null, status: 'unknown' })),
        notes: current.length ? [] : ['Seçilen tarihte geçerli önlem bulunamadı. Bu sonuç kıymetin sıfır olduğu anlamına gelmez.'] }
    }
    const dates = [...new Set([...groups.values()].map((group) => input.previousDate ?? dayBefore(earliestStart(group))).filter((date): date is string => Boolean(date)))]
    const historical = new Map<string, TariffMeasure[]>()
    const notes: string[] = []
    await Promise.all(dates.map(async (date) => {
      try {
        const url = `${API}?${new URLSearchParams({ commodityCode: code, countryCode: 'TR', queryType: 'import', queryDate: date })}`
        historical.set(date, inForceOn(parseTariffMeasures(await this.readMeasures(url)), date))
      } catch {
        notes.push(`${date} tarihli önceki değer Tariff üzerinden doğrulanamadı.`)
      }
    }))
    const comparisons: TariffComparison[] = [...groups.values()].map((group) => {
      const first = group[0]!
      const previousDate = input.previousDate ?? dayBefore(earliestStart(group))
      const previous = previousDate && historical.has(previousDate)
        ? historical.get(previousDate)!.filter((item) => item.typeCode === first.typeCode && item.origin === first.origin)
        : null
      return { typeCode: first.typeCode, typeName: first.typeName, origin: first.origin, current: group, previous, previousDate,
        status: previous === null ? 'unknown' : previous.length === 0 ? 'new' : sameMeasures(group, previous) ? 'unchanged' : 'changed' }
    })
    if (current.length === 0) notes.push('Seçilen tarihte geçerli önlem bulunamadı; önceki günün önlemleri kontrol edildi.')
    const withdrawalDate = input.previousDate ?? dayBefore(input.date)
    if (withdrawalDate && current.length === 0) {
      try {
        const url = `${API}?${new URLSearchParams({ commodityCode: code, countryCode: 'TR', queryType: 'import', queryDate: withdrawalDate })}`
        const previous = inForceOn(parseTariffMeasures(await this.readMeasures(url)), withdrawalDate).filter((item) => !input.origin || item.origin === input.origin.toUpperCase())
        for (const item of previous) comparisons.push({ typeCode: item.typeCode, typeName: item.typeName, origin: item.origin, current: [], previous: [item], previousDate: withdrawalDate, status: 'withdrawn' })
      } catch { notes.push('Önceki tarihin önlemleri doğrulanamadı.') }
    }
    return { code, date: input.date, description, source, fetchedAt: new Date().toISOString(), classification: 'SUPPORTING_NON_AUTHORITATIVE', comparisons, notes }
  }

  private async readMeasures(url: string): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await getTariffAccessToken(this.credentials, this.fetcher)
      const response = await this.fetcher(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(20_000) })
      if (response.status === 401 && attempt === 0) { clearTariffToken(); continue }
      if (!response.ok) throw new Error(`Tariff önlem sorgusu başarısız (${response.status}).`)
      return readJson(response)
    }
    throw new Error('Tariff oturumu yenilenemedi.')
  }

  private async readDescription(code: string): Promise<string | null> {
    const response = await this.fetcher(MCP, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_commodity_details', arguments: { commodity_code: code, nomenclature: 'tr', language_code: 'tr', country_of_origin: 'CN', country_of_export: 'CN' } } }),
      redirect: 'error', signal: AbortSignal.timeout(12_000) })
    if (!response.ok) return null
    const envelope = await readJson(response) as { result?: { content?: Array<{ text?: string }> } }
    const text = envelope.result?.content?.[0]?.text
    if (!text) return null
    const payload = JSON.parse(text) as { success?: boolean; data?: { description?: unknown } }
    return payload.success ? str(payload.data?.description) : null
  }
}

function str(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }
function dayBefore(date: string | null): string | null {
  if (!date || !validTariffDate(date)) return null
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() - 1)
  return day.toISOString().slice(0, 10)
}
function earliestStart(group: TariffMeasure[]): string | null { return group.map((item) => item.effectiveFrom).filter((value): value is string => Boolean(value)).sort()[0] ?? null }
function sameMeasures(a: TariffMeasure[], b: TariffMeasure[]): boolean {
  const values = (rows: TariffMeasure[]) => rows.map((item) => JSON.stringify([item.value, [...item.rates].sort()])).sort()
  return JSON.stringify(values(a)) === JSON.stringify(values(b))
}
async function readJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > MAX_RESPONSE_BYTES) throw new Error('Tariff yanıtı boyut sınırını aşıyor.')
  if (!response.body) throw new Error('Tariff yanıtı boş.')
  const chunks: Uint8Array[] = []
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.byteLength
    if (bytes > MAX_RESPONSE_BYTES) { await response.body.cancel().catch(() => undefined); throw new Error('Tariff yanıtı boyut sınırını aşıyor.') }
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown } catch { throw new Error('Tariff yanıtı JSON biçiminde değil.') }
}
