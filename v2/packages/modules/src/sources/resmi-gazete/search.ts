import { TransientError, PermanentError, type HttpFetcher } from '@atez/platform'
import { RG_BASE, clean, fihristUrl, parseFihristPage, type RgListItem } from './parse'

/**
 * RG geriye dönük araması (§9.1): `POST /Home/Filter`, ISO tarihler, sayfalı. Sonuç belge değil
 * `/fihrist?tarih=…` bağlantısıdır; belge URL'sine fihristteki başlık eşleştirmesiyle çözülür.
 */
export interface RgSearchHit {
  title: string
  date: string
  issue: string
  mukerrer: number | null
  number: string | null // kanunKararNo
  kind: string | null // mevzuatAdi
  indexUrl: string
}

export interface RgSearchResult {
  hits: RgSearchHit[]
  complete: boolean
  errors: string[]
}

const MAX_RESULTS_PER_TERM = 200

export async function searchGazette(http: HttpFetcher, terms: string[], through: string): Promise<RgSearchResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) throw new PermanentError('RG araması için ISO bitiş tarihi gerekli', 'RG_SEARCH_DATE')
  const result: RgSearchResult = { hits: [], complete: true, errors: [] }
  const unique = new Map<string, RgSearchHit>()
  // Çıplak sayı veya "Madde 3" konu araması değildir.
  const queries = [...new Set(terms.map((t) => clean(t)).filter((t) => t.length > 3 && !/^\d+$/.test(t) && !/^madde\s*\d+$/i.test(t)))]
  if (!queries.length) return { ...result, complete: false, errors: ['Konuya özgü arama terimi yok'] }
  for (const term of queries) {
    try {
      let total = Infinity
      for (let start = 0; start < total; start += 10) {
        if (start >= MAX_RESULTS_PER_TERM) throw new Error(`Arama ${MAX_RESULTS_PER_TERM} sonuç sınırına ulaştı; kapsam tamamlanmadı`)
        const body = {
          draw: start / 10 + 1,
          columns: [],
          order: [],
          start,
          length: 10,
          search: { value: '', regex: false },
          parameters: { searchtype: '1', genelaranacakkelime: term, genelbaslangictarihi: '', genelbitistarihi: through, genelsayi: '', genelmevzuatsayisi: '', genelmukerrer: '', genelmevzuatturu: '', genelkurumkodu: '' },
        }
        const res = await http.fetch({ url: `${RG_BASE}/Home/Filter`, method: 'POST', body: JSON.stringify(body), contentType: 'application/json', accept: 'application/json', noFollow: true })
        if (res.status !== 200) throw new TransientError(`RG filtre HTTP ${res.status}`, 'RG_SEARCH_HTTP')
        const json = JSON.parse(res.body.toString('utf8')) as { data?: unknown; recordsFiltered?: unknown }
        if (!Array.isArray(json.data) || !Number.isInteger(json.recordsFiltered)) throw new Error('RG filtre yanıt şeması değişti')
        total = json.recordsFiltered as number
        if (start < total && json.data.length === 0) throw new Error('RG sayfalaması beklenmeden boş döndü')
        for (const row of json.data as Record<string, unknown>[]) {
          const date = String(row.resmiGazeteTarihi ?? '').slice(0, 10)
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > through) throw new Error('RG tarih filtresi uygulanmadı veya sonuç tarihi geçersiz')
          const muk = String(row.mukerrer ?? '').match(/EVET(\d*)/i)
          const hit: RgSearchHit = {
            title: clean(String(row.konu ?? '')),
            date,
            issue: String(row.resmiGazeteSayisi ?? ''),
            mukerrer: muk ? Number(muk[1] || 1) : null,
            number: row.kanunKararNo ? String(row.kanunKararNo) : null,
            kind: row.mevzuatAdi ? clean(String(row.mevzuatAdi)) : null,
            indexUrl: new URL(String(row.url ?? ''), RG_BASE).toString(),
          }
          unique.set(`${hit.indexUrl}|${hit.title}`, hit)
        }
      }
    } catch (err) {
      if (err instanceof TransientError) throw err
      result.complete = false
      result.errors.push(`${term}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  result.hits = [...unique.values()].sort((a, b) => b.date.localeCompare(a.date))
  return result
}

/** Resmî numara eşleşmesi: `2018/5` ile `2018/5552` karışmaz (sınır kontrollü). */
export function containsNumber(text: string, number: string): boolean {
  const esc = number.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  return new RegExp(`(?<![\\d/])${esc}(?![\\d/])`).test(text)
}

const STOP = new Set(['ve', 'ile', 'ilişkin', 'dair', 'hakkında', 'bazı', 'yapılmasına', 'değişiklik', 'karar', 'tebliğ', 'yönetmelik', 'sayısı', 'no', 'bir', 'olan'])
export function titleTokens(s: string): Set<string> {
  return new Set(
    clean(s)
      .toLocaleLowerCase('tr')
      .replace(/[()’'".,:;/–-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)),
  )
}
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

export interface PriorTarget {
  title: string
  number: string | null
}

export interface ScoredHit extends RgSearchHit {
  score: number
  reasons: string[]
}

/**
 * Deterministik puanlama. Numara sınır kontrollü eşleşirse +2, başlık benzerliği ≥ 0.6 ise +2
 * (≥ 0.35 ise +1). Numara tek başına yetmez: "E: 2018/1" gibi esas numaraları da eşleşir;
 * kesin seçim için numara + başlık benzerliği gerekir. Mevcut belge hariç; eşitlikte en yeni önde.
 */
export function scoreHits(hits: RgSearchHit[], targets: PriorTarget[], exclude: { title: string; date: string }): ScoredHit[] {
  const self = titleTokens(exclude.title)
  return hits
    .filter((h) => !(h.date === exclude.date && jaccard(titleTokens(h.title), self) > 0.9))
    .map((h) => {
      let score = 0
      const reasons: string[] = []
      for (const t of targets) {
        let s = 0
        const r: string[] = []
        if (t.number && (containsNumber(h.title, t.number) || h.number === t.number)) {
          s += 2
          r.push(`numara ${t.number}`)
        }
        const j = jaccard(titleTokens(h.title), titleTokens(t.title))
        if (j >= 0.6) {
          s += 2
          r.push(`başlık benzerliği ${j.toFixed(2)}`)
        } else if (j >= 0.35) {
          s += 1
          r.push(`kısmi başlık benzerliği ${j.toFixed(2)}`)
        }
        if (s > score) {
          score = s
          reasons.splice(0, reasons.length, ...r)
        }
      }
      return { ...h, score, reasons }
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date))
}

/** Kesin seçim: en yüksek puan ≥ 3 (numara + başlık) ve ikinciden açıkça yüksekse ya da aynı puanda daha yeniyse. */
export function decideHit(scored: ScoredHit[]): { chosen: ScoredHit | null; ambiguous: boolean } {
  const [a, b] = scored
  if (!a) return { chosen: null, ambiguous: false }
  if (a.score < 3) return { chosen: null, ambiguous: true }
  if (!b || a.score - b.score >= 1 || a.date > b.date) return { chosen: a, ambiguous: false }
  return { chosen: null, ambiguous: true }
}

const normTitle = (s: string) =>
  clean(s)
    .replace(/^[–—\-\s]+/, '')
    .replace(/[’‘]/g, "'")
    .toLocaleLowerCase('tr')

/** `/fihrist?tarih=` bağlantısını belge URL'sine çözer (fihristteki başlık birebir eşleşmeli). */
export async function resolveHitToItem(http: HttpFetcher, hit: RgSearchHit): Promise<(RgListItem & { issue: string; feed: string }) | null> {
  // Aramanın döndürdüğü fihrist adresi kullanılır; günlük sayfa (dd.MM.yyyy) eski tarihlerde arşive yönlenir.
  const url = hit.mukerrer ? fihristUrl(hit.date, hit.mukerrer) : `${RG_BASE}/fihrist?tarih=${hit.date}`
  const res = await http.fetch({ url, noFollow: true })
  if (res.status !== 200) throw new TransientError(`RG fihrist HTTP ${res.status}`, 'RG_HTTP')
  const page = parseFihristPage(res.body.toString('utf8'), hit.date, hit.mukerrer)
  const want = normTitle(hit.title)
  const matches = page.items.filter((i) => normTitle(i.title) === want)
  if (matches.length !== 1) return null
  return { ...matches[0]!, issue: page.issue, feed: url }
}
