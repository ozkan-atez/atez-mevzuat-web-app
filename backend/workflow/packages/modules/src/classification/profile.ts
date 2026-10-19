import type { DocumentProfileV1, ProfileModelOutput } from '@atez/contracts'
import { normalizeForQuote } from '../documents/html'

type Decision = ProfileModelOutput['decision']

/** ISO tarih + gün (UTC, saat dilimi etkisiz). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** §7.1 PUBLICATION_PREVIOUS_DAY: önceki hal tarihi = yayım − 1 gün. */
export const comparisonDate = (publicationDate: string | null): string | null => (publicationDate ? addDays(publicationDate, -1) : null)

export const gtipDigits = (code: string) => code.replace(/\D/g, '')

export interface QuoteSource {
  label: string
  /** Metin görünümü varsa (HTML) doğrulanabilir; PDF/görselde null (K11: metin çıkarılmaz). */
  text: string | null
}

export function checkQuotes(quotes: ProfileModelOutput['basisQuotes'], sources: QuoteSource[]): { checked: number; missing: string[] } {
  const byLabel = new Map(sources.map((s) => [s.label, s.text ? normalizeForQuote(s.text) : null]))
  let checked = 0
  const missing: string[] = []
  for (const q of quotes) {
    const text = byLabel.get(q.file) ?? byLabel.get(q.file.split('#')[0]!) ?? null
    if (text === null) continue
    checked++
    if (!text.includes(normalizeForQuote(q.quote))) missing.push(q.quote)
  }
  return { checked, missing }
}

/** Parça içi sayfa numarasını özgün belgeye taşır (PART dosyaları §6.3). */
export function offsetPages(p: ProfileModelOutput, offsetFor: (label: string) => number): ProfileModelOutput {
  const defaultOffset = offsetFor('*')
  const at = (page: number | null, label?: string) => (page === null ? null : page + (label ? offsetFor(label) : defaultOffset))
  return {
    ...p,
    basisQuotes: p.basisQuotes.map((q) => ({ ...q, page: at(q.page, q.file) })),
    change: { ...p.change, effectiveRules: p.change.effectiveRules.map((r) => ({ ...r, evidencePage: at(r.evidencePage) })) },
    gtip: {
      ...p.gtip,
      codes: p.gtip.codes.map((c) => ({ ...c, page: at(c.page) })),
      tables: p.gtip.tables.map((t) => ({ ...t, pages: t.pages.map((pg) => pg + defaultOffset) })),
    },
    keyPages: p.keyPages.map((pg) => pg + defaultOffset),
  }
}

const RANK: Record<Decision, number> = { OUT: 0, REVIEW: 1, IN: 2 }
const uniqBy = <T>(xs: T[], key: (x: T) => string) => [...new Map(xs.map((x) => [key(x), x])).values()]

/** Parça profillerini tek profilde birleştirir (deterministik). */
export function mergeSegments(segments: { label: string; profile: ProfileModelOutput }[]): ProfileModelOutput {
  if (segments.length === 1) return segments[0]!.profile
  const ps = segments.map((s) => s.profile)
  const first = ps[0]!
  const decision = ps.map((p) => p.decision).reduce((a, b) => (RANK[b] > RANK[a] ? b : a))
  const sum = (f: (p: ProfileModelOutput) => number | null) => (ps.some((p) => f(p) === null) ? null : ps.reduce((a, p) => a + (f(p) ?? 0), 0))
  const hints = ps.map((p) => p.lineage.strategyHint)
  return {
    decision,
    coverage: {
      expected: { files: ps.reduce((a, p) => a + p.coverage.expected.files, 0), pages: sum((p) => p.coverage.expected.pages), tables: ps.reduce((a, p) => a + p.coverage.expected.tables, 0) },
      read: { files: ps.reduce((a, p) => a + p.coverage.read.files, 0), pages: sum((p) => p.coverage.read.pages), tables: ps.reduce((a, p) => a + p.coverage.read.tables, 0) },
      complete: ps.every((p) => p.coverage.complete),
    },
    basisQuotes: ps.flatMap((p) => p.basisQuotes),
    relevance: { score: Math.max(...ps.map((p) => p.relevance.score)), categories: [...new Set(ps.flatMap((p) => p.relevance.categories))] },
    rationale: segments.map((s) => `[${s.label}] ${s.profile.rationale}`).join('\n'),
    identity: first.identity,
    summary: `${first.summary} (Belge ${segments.length} parçada okundu.)`,
    change: {
      kind: ps.find((p) => p.change.kind !== 'NONE')?.change.kind ?? 'NONE',
      effectiveRules: uniqBy(ps.flatMap((p) => p.change.effectiveRules), (r) => JSON.stringify([r.rule, r.explicitDate, r.days, r.scope])),
    },
    gtip: {
      present: ps.some((p) => p.gtip.present),
      codes: uniqBy(ps.flatMap((p) => p.gtip.codes), (c) => c.code),
      tables: ps.flatMap((p) => p.gtip.tables),
    },
    references: uniqBy(ps.flatMap((p) => p.references), (r) => `${r.relation}|${r.targetTitle}|${r.targetNumber ?? ''}`),
    lineage: {
      needsPrior: ps.some((p) => p.lineage.needsPrior),
      strategyHint: hints.includes('TARIFF') ? 'TARIFF' : hints.includes('RG_SEARCH') ? 'RG_SEARCH' : 'NONE',
      rgQueries: [...new Set(ps.flatMap((p) => p.lineage.rgQueries))],
      tariffQueries: uniqBy(ps.flatMap((p) => p.lineage.tariffQueries), (q) => `${q.code}|${q.field}`),
    },
    affected: { parties: [...new Set(ps.flatMap((p) => p.affected.parties))], sectors: [...new Set(ps.flatMap((p) => p.affected.sectors))] },
    keyPages: [...new Set(ps.flatMap((p) => p.keyPages))].sort((a, b) => a - b),
    keywords: [...new Set(ps.flatMap((p) => p.keywords))],
    confidence: Math.min(...ps.map((p) => p.confidence)),
  }
}

export interface FinalizeContext {
  documentVersionId: string
  contentHash: string
  publication: { date: string | null; rgIssue: string | null; mukerrer: number | null }
  expected: { files: number; pages: number | null }
  skipped: { label: string; reason: string }[]
  quoteCheck: DocumentProfileV1['quoteCheck']
  parts: DocumentProfileV1['parts']
  generatedBy: DocumentProfileV1['generatedBy']
}

/**
 * Model çıktısını saklanan profile çevirir. Tarihleri kod çözer; kapsam ve alıntı
 * disiplinini uygular (eksik kapsam veya doğrulanamayan alıntı → REVIEW).
 */
export function finalizeProfile(model: ProfileModelOutput, ctx: FinalizeContext): DocumentProfileV1 {
  const pub = ctx.publication.date
  const adjustments: DocumentProfileV1['decisionAdjustments'] = []
  let decision = model.decision
  const toReview = (reason: string) => {
    if (decision !== 'REVIEW') adjustments.push({ from: decision, to: 'REVIEW', reason })
    decision = 'REVIEW'
  }

  const coverage = {
    expected: { files: ctx.expected.files + ctx.skipped.length, pages: ctx.expected.pages, tables: model.coverage.expected.tables },
    read: model.coverage.read,
    complete: model.coverage.complete && ctx.skipped.length === 0 && model.coverage.read.files >= ctx.expected.files,
  }
  if (!coverage.complete) {
    const why = ctx.skipped.length ? `okunamayan dosya: ${ctx.skipped.map((s) => `${s.label} (${s.reason})`).join(', ')}` : 'model kapsamı eksik bildirdi'
    toReview(`Kapsam eksik — ${why}`)
  }
  if (ctx.quoteCheck.status === 'FAILED') toReview(`Alıntı kaynakta birebir bulunamadı (${ctx.quoteCheck.missing.length})`)

  return {
    ...model,
    schemaVersion: 1,
    documentVersionId: ctx.documentVersionId,
    contentHash: ctx.contentHash,
    decision,
    coverage,
    identity: { ...model.identity, publication: ctx.publication },
    change: {
      kind: model.change.kind,
      effectiveRules: model.change.effectiveRules.map((r) => ({
        ...r,
        resolvedDate:
          r.rule === 'ON_PUBLICATION'
            ? pub
            : r.rule === 'EXPLICIT_DATE'
              ? r.explicitDate
              : r.rule === 'DAYS_AFTER_PUBLICATION' && pub && r.days !== null
                ? addDays(pub, r.days)
                : null,
      })),
    },
    gtip: { ...model.gtip, codes: model.gtip.codes.map((c) => ({ ...c, code: c.code.trim() })) },
    lineage: {
      ...model.lineage,
      comparisonPolicy: 'PUBLICATION_PREVIOUS_DAY',
      // Kısa GTİP sıfırla doldurulmaz (§7): NEEDS_CODE_EXPANSION işaretlenir.
      tariffQueries: model.lineage.tariffQueries.map((q) => ({ ...q, asOf: comparisonDate(pub), needsCodeExpansion: gtipDigits(q.code).length < 12 })),
    },
    quoteCheck: ctx.quoteCheck,
    decisionAdjustments: adjustments,
    parts: ctx.parts,
    generatedBy: ctx.generatedBy,
  }
}
