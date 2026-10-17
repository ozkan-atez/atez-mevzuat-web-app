import { z } from 'zod'
import { DiscoveredItem, SourcePrecheck } from './source'
import { ProfileDecision } from './profile'

/**
 * Adım kataloğu (§5.1). Kuyruklar süreç değil havuz bazındadır (§12); her adım tek bir
 * havuza aittir. Girdi/çıktı şemaları web ile paylaşılır.
 */
export const Pool = z.enum(['io', 'browser', 'doc', 'ai-lite', 'ai-main', 'ai-interactive', 'render', 'delivery'])
export type Pool = z.infer<typeof Pool>

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

// ---- Örnek (Aşama 1 iskelet testi) -----------------------------------------
export const DemoSplitInput = z.object({ text: z.string() })
export const DemoSplitOutput = z.object({ words: z.array(z.string()) })
export const DemoUpperInput = z.string()
export const DemoUpperOutput = z.object({ value: z.string() })
export const DemoJoinInput = z.array(DemoUpperOutput)
export const DemoJoinOutput = z.object({ text: z.string(), count: z.number().int() })

// ---- source.discover ---------------------------------------------------------
export const SourceDiscoverInput = z.object({ sourceId: z.string(), date: IsoDate })
export const SourceDiscoverOutput = z.object({
  sourceId: z.string(),
  date: IsoDate,
  precheck: SourcePrecheck,
  candidates: z.array(DiscoveredItem),
  counts: z.object({ listed: z.number().int(), new: z.number().int(), pending: z.number().int(), skipped: z.number().int() }),
})

// ---- classify.title ----------------------------------------------------------
export const TitleDecision = z.enum(['IN', 'OUT', 'MAYBE'])
export const TitleDecisionItem = z.object({
  candidate: DiscoveredItem,
  decision: TitleDecision,
  reason: z.string(),
  by: z.enum(['RULE', 'MODEL']),
})
export type TitleDecisionItem = z.infer<typeof TitleDecisionItem>
export const ClassifyTitleInput = z.object({ candidates: z.array(DiscoveredItem) })
export const ClassifyTitleOutput = z.object({ items: z.array(TitleDecisionItem) })

// ---- doc.fetch ---------------------------------------------------------------
export const FileRole = z.enum(['ORIGINAL', 'MODEL_INPUT', 'PART', 'ATTACHMENT'])
export type FileRole = z.infer<typeof FileRole>
export const FileRef = z.object({
  fileId: z.string().uuid(),
  role: FileRole,
  label: z.string(), // f1, f2… — modele ve alıntılara verilen etiket
  mime: z.string(),
  bytes: z.number().int(),
  sha256: z.string(),
  objectKey: z.string(),
  pageRange: z.tuple([z.number().int(), z.number().int()]).nullable(),
})
export type FileRef = z.infer<typeof FileRef>
export const ContentDelta = z.enum(['NEW', 'CHANGED', 'SAME'])
export const DocFetchInput = TitleDecisionItem
export const DocFetchOutput = z.object({
  documentId: z.string().uuid(),
  documentVersionId: z.string().uuid(),
  contentHash: z.string(),
  delta: ContentDelta,
  files: z.array(FileRef),
  manifestKey: z.string(),
  /** Edinilemeyen ekler; profil kapsamını eksik kılar (→ REVIEW). */
  failed: z.array(z.object({ url: z.string(), reason: z.string() })),
})

// ---- doc.normalize -----------------------------------------------------------
export const DocNormalizeInput = DocFetchOutput
export const DocNormalizeOutput = z.object({
  documentVersionId: z.string().uuid(),
  contentHash: z.string(),
  modelInputs: z.array(FileRef),
  /** Modele verilemeyen dosyalar (desteklenmeyen biçim, edinilemeyen ek). */
  skipped: z.array(z.object({ label: z.string(), reason: z.string() })),
})

// ---- classify.profile --------------------------------------------------------
export const ClassifyProfileInput = DocNormalizeOutput
export const ClassifyProfileOutput = z.object({
  documentVersionId: z.string().uuid(),
  profileId: z.string().uuid(),
  profileVersion: z.number().int().min(1),
  decision: ProfileDecision,
  objectKey: z.string(),
})

// ---- entry.documents (planlayıcı `entry`: belge kimlikleriyle başlayan tarifler) ----
export const EntryDocumentsInput = z.object({ documentVersionIds: z.array(z.string().uuid()).min(1) })
export const DocRef = z.object({ documentVersionId: z.string().uuid() })
export const EntryDocumentsOutput = z.object({ items: z.array(DocRef) })

// ---- extract.table -------------------------------------------------------------
export const ExtractTableInput = DocRef
export const ExtractTableOutput = z.object({
  documentVersionId: z.string().uuid(),
  status: z.enum(['NO_TABLES', 'EXTRACTED', 'PARTIAL']),
  rows: z.number().int(),
  tables: z.array(z.object({ title: z.string(), pages: z.array(z.number().int()), rows: z.number().int(), expectedRows: z.number().int().nullable() })),
  issues: z.array(z.string()),
})

// ---- lineage.resolve -------------------------------------------------------------
export const LineageStatus = z.enum(['NOT_NEEDED', 'FOUND', 'PARTIAL', 'AMBIGUOUS', 'SINGLE_SOURCE'])
export const LineageResolveInput = DocRef
export const LineageResolveOutput = z.object({
  documentVersionId: z.string().uuid(),
  status: LineageStatus,
  attempts: z.array(z.object({ strategy: z.enum(['TARIFF', 'RG_SEARCH']), status: z.string(), note: z.string().nullable() })),
  relations: z.array(
    z.object({
      relationId: z.string().uuid(),
      relation: z.string(),
      toVersionId: z.string().uuid().nullable(),
      tariffSnapshotId: z.string().uuid().nullable(),
      ambiguous: z.boolean(),
    }),
  ),
})

// ---- topic.link ----------------------------------------------------------------
export const TopicLinkInput = DocRef
export const TopicLinkOutput = z.object({
  documentVersionId: z.string().uuid(),
  topicId: z.string().uuid(),
  matchedBy: z.enum(['RG_REFERENCE', 'OFFICIAL_NUMBER', 'AI_SAME_EVENT', 'NEW_TOPIC', 'EXISTING_MEMBER']),
})

// ---- topic.analyze ---------------------------------------------------------------
export const TopicAnalyzeInput = z.object({ topicId: z.string().uuid() })
export const TopicAnalyzeOutput = z.object({
  topicId: z.string().uuid(),
  analysisId: z.string().uuid(),
  revision: z.number().int(),
  status: z.enum(['OK', 'REVIEW']),
  comparisonRows: z.number().int(),
  objectKey: z.string(),
})

// ---- report.compose / report.render -----------------------------------------------
export const ReportComposeInput = TopicAnalyzeOutput
export const ReportComposeOutput = z.object({
  reportId: z.string().uuid(),
  revision: z.number().int(),
  card: z.string(),
  specKey: z.string(),
})
export const ReportRenderInput = ReportComposeOutput
export const ReportRenderOutput = z.object({
  reportId: z.string().uuid(),
  revision: z.number().int(),
  status: z.literal('READY'),
  htmlKey: z.string(),
  issues: z.array(z.string()),
})

export interface StepContract {
  pool: Pool
  /** Dış dünyaya (ağ, AI) çıkıyor mu? REUSE_ONLY modunda dış adımlar çalıştırılmaz. */
  external: boolean
  input: z.ZodType
  output: z.ZodType
}

export const STEP_CATALOG = {
  'demo.split': { pool: 'doc', external: false, input: DemoSplitInput, output: DemoSplitOutput },
  'demo.upper': { pool: 'doc', external: true, input: DemoUpperInput, output: DemoUpperOutput },
  'demo.join': { pool: 'doc', external: false, input: DemoJoinInput, output: DemoJoinOutput },
  'source.discover': { pool: 'io', external: true, input: SourceDiscoverInput, output: SourceDiscoverOutput },
  'classify.title': { pool: 'ai-lite', external: true, input: ClassifyTitleInput, output: ClassifyTitleOutput },
  'doc.fetch': { pool: 'io', external: true, input: DocFetchInput, output: DocFetchOutput },
  'doc.normalize': { pool: 'doc', external: false, input: DocNormalizeInput, output: DocNormalizeOutput },
  'classify.profile': { pool: 'ai-main', external: true, input: ClassifyProfileInput, output: ClassifyProfileOutput },
  'entry.documents': { pool: 'doc', external: false, input: EntryDocumentsInput, output: EntryDocumentsOutput },
  'extract.table': { pool: 'ai-main', external: true, input: ExtractTableInput, output: ExtractTableOutput },
  'lineage.resolve': { pool: 'ai-main', external: true, input: LineageResolveInput, output: LineageResolveOutput },
  'topic.link': { pool: 'ai-lite', external: true, input: TopicLinkInput, output: TopicLinkOutput },
  'topic.analyze': { pool: 'ai-main', external: true, input: TopicAnalyzeInput, output: TopicAnalyzeOutput },
  'report.compose': { pool: 'ai-main', external: true, input: ReportComposeInput, output: ReportComposeOutput },
  'report.render': { pool: 'render', external: false, input: ReportRenderInput, output: ReportRenderOutput },
} as const satisfies Record<string, StepContract>

export type StepKey = keyof typeof STEP_CATALOG
export const STEP_KEYS = Object.keys(STEP_CATALOG) as StepKey[]
export type StepInput<K extends StepKey> = z.infer<(typeof STEP_CATALOG)[K]['input']>
export type StepOutput<K extends StepKey> = z.infer<(typeof STEP_CATALOG)[K]['output']>
export const isStepKey = (k: string): k is StepKey => Object.hasOwn(STEP_CATALOG, k)
