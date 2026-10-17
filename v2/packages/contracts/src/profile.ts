import { z } from 'zod'

/**
 * Belge Profili v1 (§6.2). İki katman:
 *  - `ProfileModelOutput`: modelin döndürmesi gereken yapı (yalnızca belgeden okunabilenler).
 *  - `DocumentProfileV1`: koda ait alanlar eklenmiş, saklanan profil. Tarihler (yürürlük,
 *    TARIFF `asOf`) modelden değil koddan çözülür.
 */

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')

export const ProfileDecision = z.enum(['IN', 'OUT', 'REVIEW'])
export type ProfileDecision = z.infer<typeof ProfileDecision>

export const DocType = z.enum([
  'KANUN',
  'CUMHURBASKANLIGI_KARARNAMESI',
  'KARAR',
  'YONETMELIK',
  'TEBLIG',
  'GENELGE',
  'DUYURU',
  'ILAN',
  'MILLETLERARASI_ANDLASMA',
  'YARGI_KARARI',
  'DIGER',
])

export const ChangeKind = z.enum(['NEW', 'AMENDMENT', 'REPEAL', 'EXTENSION', 'SUSPENSION', 'ANNOUNCEMENT', 'NONE'])

export const EffectiveRuleKind = z.enum(['ON_PUBLICATION', 'EXPLICIT_DATE', 'DAYS_AFTER_PUBLICATION', 'UNRESOLVED'])

export const RelationKind = z.enum(['AMENDS', 'REPEALS', 'EXTENDS', 'IMPLEMENTS', 'REFERENCES'])
/** document_relation tipleri (§4.1) + TARIFF önceki değeri (§7). */
export const DocumentRelationKind = z.enum(['AMENDS', 'REPEALS', 'EXTENDS', 'IMPLEMENTS', 'REFERENCES', 'ATTACHMENT_OF', 'SAME_EVENT', 'PRIOR_VALUE'])

/** TARIFF alan → önlem tipi eşlemesi §7'de; burada yalnızca alan adı. */
export const TariffField = z.enum([
  'GOZETIM_DEGERI',
  'DAMPING',
  'ILAVE_GUMRUK_VERGISI',
  'GUMRUK_VERGISI',
  'EK_MALI_YUKUMLULUK',
  'KDV',
  'DIGER',
])

const Coverage = z.object({
  expected: z.object({ files: z.number().int().min(0), pages: z.number().int().min(0).nullable(), tables: z.number().int().min(0) }),
  read: z.object({ files: z.number().int().min(0), pages: z.number().int().min(0).nullable(), tables: z.number().int().min(0) }),
  complete: z.boolean(),
})

const BasisQuote = z.object({
  quote: z.string().min(1),
  file: z.string().min(1), // modele verilen dosya etiketi: f1, f2…
  page: z.number().int().min(1).nullable(),
})

const ModelEffectiveRule = z.object({
  rule: EffectiveRuleKind,
  explicitDate: IsoDate.nullable(),
  days: z.number().int().min(0).nullable(),
  scope: z.string().nullable(),
  evidencePage: z.number().int().min(1).nullable(),
})

const GtipCode = z.object({
  code: z.string().min(2), // biçim kodda normalize edilir
  level: z.enum(['2', '4', '6', '8', '10', '12']),
  context: z.string(),
  page: z.number().int().min(1).nullable(),
})

const GtipTable = z.object({
  title: z.string(),
  /** Tablonun bulunduğu dosya etiketi (f1, f2…); eski profillerde yok → f1. */
  file: z.string().optional(),
  pages: z.array(z.number().int().min(1)),
  approxRows: z.number().int().min(0).nullable(),
  columns: z.array(z.string()),
})

const Reference = z.object({
  relation: RelationKind,
  targetTitle: z.string(),
  targetNumber: z.string().nullable(),
  targetType: DocType.nullable(),
  articles: z.array(z.string()),
})

export const ProfileModelOutput = z.object({
  decision: ProfileDecision,
  coverage: Coverage,
  basisQuotes: z.array(BasisQuote),
  relevance: z.object({ score: z.number().min(0).max(1), categories: z.array(z.string()) }),
  rationale: z.string().min(1),
  identity: z.object({
    docType: DocType,
    title: z.string().min(1),
    institution: z.string().nullable(),
    officialNumber: z.string().nullable(),
  }),
  summary: z.string().min(1),
  change: z.object({ kind: ChangeKind, effectiveRules: z.array(ModelEffectiveRule) }),
  gtip: z.object({ present: z.boolean(), codes: z.array(GtipCode), tables: z.array(GtipTable) }),
  references: z.array(Reference),
  lineage: z.object({
    needsPrior: z.boolean(),
    strategyHint: z.enum(['TARIFF', 'RG_SEARCH', 'NONE']),
    rgQueries: z.array(z.string()),
    tariffQueries: z.array(z.object({ code: z.string(), field: TariffField })),
  }),
  affected: z.object({ parties: z.array(z.string()), sectors: z.array(z.string()) }),
  keyPages: z.array(z.number().int().min(1)),
  keywords: z.array(z.string()),
  confidence: z.number().min(0).max(1),
})
export type ProfileModelOutput = z.infer<typeof ProfileModelOutput>

export const QuoteCheck = z.object({
  /** HTML/metin girdilerinde birebir aranır; PDF/görselde metin katmanı yok (K11) → NOT_CHECKED. */
  status: z.enum(['VERIFIED', 'FAILED', 'NOT_CHECKED']),
  checked: z.number().int().min(0),
  missing: z.array(z.string()),
  repairRounds: z.number().int().min(0),
})

export const DocumentProfileV1 = ProfileModelOutput.extend({
  schemaVersion: z.literal(1),
  documentVersionId: z.string().uuid(),
  contentHash: z.string(),
  identity: ProfileModelOutput.shape.identity.extend({
    publication: z.object({
      date: IsoDate.nullable(),
      rgIssue: z.string().nullable(),
      mukerrer: z.number().int().min(1).nullable(),
    }),
  }),
  change: z.object({
    kind: ChangeKind,
    effectiveRules: z.array(ModelEffectiveRule.extend({ resolvedDate: IsoDate.nullable() })),
  }),
  lineage: ProfileModelOutput.shape.lineage.extend({
    /** `asOf` = yayım tarihi − 1 gün (PUBLICATION_PREVIOUS_DAY, §7.1); kod yazar. */
    comparisonPolicy: z.literal('PUBLICATION_PREVIOUS_DAY'),
    tariffQueries: z.array(z.object({ code: z.string(), field: TariffField, asOf: IsoDate.nullable(), needsCodeExpansion: z.boolean() })),
  }),
  quoteCheck: QuoteCheck,
  /** Kodun karara yaptığı düzeltmeler (ör. eksik kapsam → REVIEW). */
  decisionAdjustments: z.array(z.object({ from: ProfileDecision, to: ProfileDecision, reason: z.string() })),
  parts: z.array(z.object({ label: z.string(), pageRange: z.tuple([z.number().int(), z.number().int()]).nullable() })),
  generatedBy: z.object({ model: z.string(), promptVersion: z.string(), aiCallIds: z.array(z.string()) }),
})
export type DocumentProfileV1 = z.infer<typeof DocumentProfileV1>
