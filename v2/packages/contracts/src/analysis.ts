import { z } from 'zod'

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Karşılaştırma satırı: eşleştirme ve yüzde kodla hesaplanır (§8, K14). */
export const ComparisonRow = z.object({
  gtip: z.string(),
  description: z.string().nullable(),
  origin: z.string().nullable(),
  unit: z.string().nullable(),
  currency: z.string().nullable(),
  previous: z.object({ value: z.string().nullable(), raw: z.string().nullable(), source: z.string(), note: z.string().nullable().optional() }).nullable(),
  current: z.object({ value: z.string().nullable(), raw: z.string().nullable(), source: z.string() }).nullable(),
  /** (yeni − eski) / eski × 100, iki ondalık; hesaplanamıyorsa null. */
  changePct: z.string().nullable(),
  status: z.enum(['CHANGED', 'UNCHANGED', 'NEW', 'REMOVED', 'NO_PRIOR']),
})
export type ComparisonRow = z.infer<typeof ComparisonRow>

export const Evidence = z.object({
  kind: z.enum(['DOCUMENT', 'TARIFF']),
  /** Belge için `d1:f1` gibi etiket, TARIFF için `t1`. */
  ref: z.string(),
  page: z.number().int().min(1).nullable(),
  quote: z.string().nullable(),
})

/** Modelin yazdığı kısım: yorum ve iddialar. Sayılar ve tablolar koddan gelir. */
export const AnalysisModelOutput = z.object({
  summary: z.string().min(1),
  operationalImpact: z.string(),
  affected: z.object({ parties: z.array(z.string()), sectors: z.array(z.string()) }),
  claims: z.array(z.object({ text: z.string().min(1), evidence: z.array(Evidence).min(1) })),
  comparisonCommentary: z.string().nullable(),
  exceptions: z.array(z.string()),
})
export type AnalysisModelOutput = z.infer<typeof AnalysisModelOutput>

export const AnalysisV1 = AnalysisModelOutput.extend({
  schemaVersion: z.literal(1),
  topicId: z.string().uuid(),
  revision: z.number().int().min(1),
  status: z.enum(['OK', 'REVIEW']),
  documents: z.array(
    z.object({
      ref: z.string(),
      documentVersionId: z.string().uuid(),
      role: z.enum(['PRIMARY', 'SUPPORTING', 'SIGNAL', 'PRIOR']),
      title: z.string(),
      publicationDate: IsoDate.nullable(),
      officialNumber: z.string().nullable(),
      url: z.string().nullable(),
    }),
  ),
  priorState: z.object({
    status: z.enum(['FOUND', 'PARTIAL', 'AMBIGUOUS', 'SINGLE_SOURCE', 'NOT_NEEDED']),
    comparisonDate: IsoDate.nullable(),
    tariffSnapshots: z.array(z.object({ ref: z.string(), snapshotId: z.string().uuid(), gtip: z.string(), queryDate: IsoDate })),
    note: z.string().nullable(),
  }),
  dates: z.object({
    publication: IsoDate.nullable(),
    effective: z.array(z.object({ scope: z.string().nullable(), rule: z.string(), date: IsoDate.nullable() })),
  }),
  comparison: z.object({ rows: z.array(ComparisonRow), note: z.string().nullable() }),
  quoteCheck: z.object({ status: z.enum(['VERIFIED', 'FAILED', 'NOT_CHECKED']), checked: z.number().int(), missing: z.array(z.string()) }),
  issues: z.array(z.string()),
  generatedBy: z.object({ model: z.string(), promptVersion: z.string(), aiCallIds: z.array(z.string()) }),
})
export type AnalysisV1 = z.infer<typeof AnalysisV1>

/** Kart türleri (§10): analiz ve profil alanlarından kuralla seçilir. */
export const ReportCard = z.enum(['YENI_DUZENLEME', 'ORAN_TABLOSU', 'SURE_UZATIMI', 'YURURLUKTEN_KALDIRMA', 'DUYURU', 'DEGISIKLIK_YOK'])
export type ReportCard = z.infer<typeof ReportCard>

export const ReportTextFields = z.object({
  headline: z.string().min(1),
  lead: z.string().min(1),
  keyPoints: z.array(z.string()).min(1).max(8),
  impact: z.string(),
  tableNote: z.string().nullable(),
})
export type ReportTextFields = z.infer<typeof ReportTextFields>

export const ReportSpecV1 = z.object({
  schemaVersion: z.literal(1),
  reportId: z.string().uuid(),
  revision: z.number().int().min(1),
  topicId: z.string().uuid(),
  analysisId: z.string().uuid(),
  card: ReportCard,
  fields: ReportTextFields,
  dates: AnalysisV1.shape.dates,
  comparison: AnalysisV1.shape.comparison.nullable(),
  priorState: AnalysisV1.shape.priorState,
  sources: z.array(z.object({ title: z.string(), url: z.string().nullable(), publicationDate: IsoDate.nullable(), role: z.string() })),
  validation: z.object({ numbersChecked: z.number().int(), unmatchedNumbers: z.array(z.string()), repairRounds: z.number().int() }),
  generatedBy: z.object({ model: z.string(), promptVersion: z.string(), aiCallIds: z.array(z.string()) }),
})
export type ReportSpecV1 = z.infer<typeof ReportSpecV1>
