/**
 * capture-manifest `hints` (§9.2): DETERMINİSTİK ipuçları (regex), AI değil. Yalnızca metin
 * olarak elde olan içerikte (HTML) çalışır; PDF'ten metin çıkarılmaz (K11).
 */
export interface CaptureHints {
  rgReferences: { url: string; date: string | null; mukerrer: number | null; item: number | null }[]
  officialNumbers: string[]
  amendsPhrases: string[]
  gtipCandidates: { code: string; context: string }[]
  datesInText: { date: string; phrase: string }[]
}

export const emptyHints = (): CaptureHints => ({ rgReferences: [], officialNumbers: [], amendsPhrases: [], gtipCandidates: [], datesInText: [] })

const uniq = <T>(xs: T[], key: (x: T) => string) => {
  const seen = new Map<string, T>()
  for (const x of xs) if (!seen.has(key(x))) seen.set(key(x), x)
  return [...seen.values()]
}

export function extractHints(text: string, title: string): CaptureHints {
  const rgReferences = uniq(
    [...text.matchAll(/https?:\/\/(?:www\.)?resmigazete\.gov\.tr\/eskiler\/\d{4}\/\d{2}\/(\d{4})(\d{2})(\d{2})(?:M(\d+))?-(\d+)\.(?:pdf|htm)/gi)].map((m) => ({
      url: m[0],
      date: `${m[1]}-${m[2]}-${m[3]}`,
      mukerrer: m[4] ? Number(m[4]) : null,
      item: Number(m[5]),
    })),
    (r) => r.url,
  )
  const both = `${title}\n${text}`
  const officialNumbers = uniq(
    [...both.matchAll(/(Karar Sayısı\s*:\s*\d+|(?:No|Sıra No|Sıra Numarası)\s*:\s*\d{4}\/\d+|(?:İthalat|İhracat)\s*:\s*\d{4}\/\d+)/gi)].map((m) => m[1]!.replace(/\s+/g, ' ')),
    (s) => s.toLocaleLowerCase('tr'),
  )
  const amendsPhrases = uniq(
    [...both.matchAll(/([^.\n]{0,160}(?:Değişiklik Yapılmasına (?:Dair|İlişkin)|yürürlükten kaldırılmıştır)[^.\n]{0,40})/gi)].map((m) => m[1]!.trim()),
    (s) => s,
  ).slice(0, 10)
  const gtipCandidates = uniq(
    [...text.matchAll(/(?<![\d.])(\d{4}\.\d{2}(?:\.\d{2}){0,3})(?![\d])/g)].map((m) => ({
      code: m[1]!,
      context: text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + m[1]!.length + 40).replace(/\s+/g, ' '),
    })),
    (g) => g.code,
  ).slice(0, 200)
  const datesInText = uniq(
    [...text.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[^.\n]{0,60}yürürlüğe)/g)].map((m) => ({
      date: `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`,
      phrase: m[0].slice(0, 120),
    })),
    (d) => d.phrase,
  )
  return { rgReferences, officialNumbers, amendsPhrases, gtipCandidates, datesInText }
}
