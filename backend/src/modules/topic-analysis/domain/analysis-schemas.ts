import { z } from 'zod'
import { toGeminiJsonSchema } from '../../ai/application/gemini-json-schema'

const nonEmptyText = z.string().trim().min(1).refine(
  (value) => !['-', '—', 'N/A'].includes(value),
  'Dolgu metni kullanılamaz',
)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-MM-DD olmalıdır')
const httpUrl = z.string().url().refine((value) => /^https?:\/\//.test(value), 'Kaynak URL http(s) olmalıdır')

export const DocumentIdentitySchema = z.object({
  title: nonEmptyText,
  documentNumber: nonEmptyText.optional(),
  gazetteDate: isoDate,
  gazetteNumber: nonEmptyText,
  sourceUrl: httpUrl,
}).strict()

export const ChangeSchema = z.object({
  type: z.enum(['NEW_REGULATION', 'AMENDMENT', 'DEADLINE_EXTENSION', 'REPEAL', 'SUSPENSION', 'ANNOUNCEMENT', 'NO_CHANGE']),
  detailedAnalysis: nonEmptyText,
  summary: nonEmptyText,
  previousRule: nonEmptyText.optional(),
  currentRule: nonEmptyText.optional(),
  operationalImpact: nonEmptyText.optional(),
}).strict()

export const AffectedPartySchema = z.object({
  name: nonEmptyText,
  impact: nonEmptyText,
  evidenceIds: z.array(nonEmptyText).min(1),
}).strict()

export const EffectiveDateSchema = z.object({
  date: isoDate,
  description: nonEmptyText,
  evidenceIds: z.array(nonEmptyText).min(1),
}).strict()

export const ComparisonSchema = z.object({
  label: nonEmptyText,
  before: nonEmptyText,
  after: nonEmptyText,
  evidenceIds: z.array(nonEmptyText).min(1),
}).strict()

export const AnalysisTableSchema = z.object({
  title: nonEmptyText,
  columns: z.array(nonEmptyText).min(2).max(12),
  rows: z.array(z.array(nonEmptyText).min(2).max(12)).min(1).max(500),
  note: nonEmptyText.optional(),
  evidenceIds: z.array(nonEmptyText).min(1),
}).strict().superRefine((table, context) => {
  table.rows.forEach((row, index) => {
    if (row.length !== table.columns.length) {
      context.addIssue({
        code: 'custom',
        path: ['rows', index],
        message: 'Tablo satırı sütun sayısıyla eşleşmelidir',
      })
    }
  })
})

export const SourceSchema = z.object({
  id: nonEmptyText,
  label: nonEmptyText,
  url: httpUrl,
  evidenceIds: z.array(nonEmptyText).min(1),
}).strict()

export const EvidenceLocatorSchema = z.object({
  id: nonEmptyText,
  objectKey: nonEmptyText,
  locator: nonEmptyText,
  excerpt: nonEmptyText.optional(),
}).strict()

export const UnresolvedReferenceSchema = z.object({
  reference: nonEmptyText,
  reason: nonEmptyText,
}).strict()

export const AnalysisResultSchema = z.object({
  schemaVersion: z.literal(1),
  topicId: z.string().uuid(),
  status: z.enum(['PASS', 'PASS_NO_RELEVANT_CONTENT']),
  document: DocumentIdentitySchema,
  change: ChangeSchema,
  affectedParties: z.array(AffectedPartySchema).max(20),
  effectiveDates: z.array(EffectiveDateSchema).max(20),
  comparisons: z.array(ComparisonSchema).max(20),
  tables: z.array(AnalysisTableSchema).max(20),
  officialSources: z.array(SourceSchema).min(1),
  supportingSources: z.array(SourceSchema).max(20),
  evidence: z.array(EvidenceLocatorSchema).min(1),
  unresolvedReferences: z.array(UnresolvedReferenceSchema).max(50),
  emailTitle: nonEmptyText.max(120),
  emailSummary: nonEmptyText.max(8_000),
}).strict().superRefine((analysis, context) => {
  const evidenceIds = new Set(analysis.evidence.map((item) => item.id))
  const referencedIds = [
    ...analysis.affectedParties.flatMap((item) => item.evidenceIds),
    ...analysis.effectiveDates.flatMap((item) => item.evidenceIds),
    ...analysis.comparisons.flatMap((item) => item.evidenceIds),
    ...analysis.tables.flatMap((item) => item.evidenceIds),
    ...analysis.officialSources.flatMap((item) => item.evidenceIds),
    ...analysis.supportingSources.flatMap((item) => item.evidenceIds),
  ]
  const missing = referencedIds.filter((id) => !evidenceIds.has(id))
  if (missing.length > 0) {
    context.addIssue({ code: 'custom', path: ['evidence'], message: `Tanımsız kanıt referansı: ${[...new Set(missing)].join(', ')}` })
  }
  if (analysis.status === 'PASS_NO_RELEVANT_CONTENT' && analysis.change.type !== 'NO_CHANGE') {
    context.addIssue({ code: 'custom', path: ['change', 'type'], message: 'İçerik yok durumunda değişiklik türü NO_CHANGE olmalıdır' })
  }
})

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>

export const analysisContractJsonSchema = toGeminiJsonSchema(z.toJSONSchema(AnalysisResultSchema, { target: 'draft-7' }) as Record<string, unknown>)

// Gemini rejects the full nested contract as too complex for responseJsonSchema.
// The complete contract is supplied in the system instruction and enforced by Zod after generation.
export const analysisResponseJsonSchema: Record<string, unknown> = { type: 'object' }
