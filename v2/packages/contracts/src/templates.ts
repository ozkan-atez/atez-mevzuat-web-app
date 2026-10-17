import { z } from 'zod'

/**
 * Şablon stüdyosu ve bileşen havuzu (§10.1). Bileşen tanımı ham HTML değildir: tipli bir node
 * ağacıdır (en fazla iki seviye: kök node'lar ve `container` çocukları). Metin üç kaynaktan gelir:
 * sabit `text`, analizden veri bağı `bind` ya da `report.compose`'un doldurduğu `slot`.
 */

const Key = z.string().regex(/^[a-z][a-z0-9-]{1,47}$/, 'küçük harf, rakam ve tire')
/** Slot anahtarı: compose çıktısındaki alan adı (camelCase). */
const SlotKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{1,39}$/, 'harf ve rakam (camelCase)')
const Path = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]*$/).max(120)

export const ComponentCategory = z.enum([
  'BASLIK',
  'OZET',
  'DEGISIKLIK_KARTI',
  'KARSILASTIRMA_TABLOSU',
  'GTIP_TABLOSU',
  'ZAMAN_CIZELGESI',
  'ETKILENENLER',
  'KAYNAKLAR',
  'NOT_UYARI',
])
export type ComponentCategory = z.infer<typeof ComponentCategory>
export const ComponentOrigin = z.enum(['BUILTIN', 'USER', 'AI'])
export const ComponentStatus = z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED'])

export const NodeType = z.enum(['container', 'heading', 'text', 'badge', 'list', 'metadata', 'table', 'compare', 'timeline', 'note', 'sources', 'divider'])
export const ValueFormat = z.enum(['text', 'number', 'percent', 'date', 'gtip'])

const Column = z.object({ header: z.string().max(80), value: Path, format: ValueFormat.default('text') }).strict()
const MetaRow = z.object({ label: z.string().max(80), bind: Path, format: ValueFormat.default('text') }).strict()
const CompareSide = z.object({ label: z.string().max(80), bind: Path.optional(), slot: SlotKey.optional(), text: z.string().max(400).optional() }).strict()

/** Node özellikleri düz tutulur (Gemini şemasında özyineleme yok); tip başına kurallar kodla doğrulanır. */
const NodeFields = {
  type: NodeType,
  text: z.string().max(2000).optional(),
  bind: Path.optional(),
  slot: SlotKey.optional(),
  label: z.string().max(120).optional(),
  level: z.union([z.literal(2), z.literal(3)]).optional(),
  variant: z.enum(['default', 'info', 'alert']).optional(),
  classes: z.array(z.string().max(40)).max(6).optional(),
  columns: z.array(Column).max(10).optional(),
  rows: z.array(MetaRow).max(10).optional(),
  before: CompareSide.optional(),
  after: CompareSide.optional(),
  date: Path.optional(),
  /** timeline: satır metninin göreli yolu. */
  itemText: Path.optional(),
  format: ValueFormat.optional(),
  emptyText: z.string().max(400).optional(),
}
export const LeafNode = z.object(NodeFields).strict()
export type LeafNode = z.infer<typeof LeafNode>
export const ComponentNode = z.object({ ...NodeFields, children: z.array(LeafNode).max(20).optional() }).strict()
export type ComponentNode = z.infer<typeof ComponentNode>

/** `report.compose`'un dolduracağı metin alanı. Sayılar yalnızca analizden gelebilir. */
export const ComponentSlot = z.object({
  key: SlotKey,
  kind: z.enum(['text', 'list']),
  instruction: z.string().min(1).max(600),
}).strict()
export type ComponentSlot = z.infer<typeof ComponentSlot>

export const ComponentDefinition = z
  .object({
    schemaVersion: z.literal(1),
    nodes: z.array(ComponentNode).min(1).max(20),
    slots: z.array(ComponentSlot).max(8),
    /** CEL; bağlam: `analysis`, `document`. Boşsa her zaman görünür. */
    appliesWhen: z.string().max(400),
    /** Bileşenin kullandığı veri yolları (kodla hesaplanır ve doğrulanır). */
    bindings: z.array(Path).max(40),
    /** Önizleme verisi; ortak örnek analizin üzerine birleştirilir. Yalnızca slot metinleri. */
    sampleData: z.object({ slots: z.record(z.string(), z.union([z.string(), z.array(z.string())])) }).strict(),
  })
  .strict()
export type ComponentDefinition = z.infer<typeof ComponentDefinition>

export const ComponentRecord = z.object({
  id: z.string().uuid(),
  key: Key,
  name: z.string().min(1).max(120),
  description: z.string().max(1000),
  category: ComponentCategory,
  origin: ComponentOrigin,
  status: ComponentStatus,
  currentVersion: z.number().int().min(1),
  definition: ComponentDefinition,
})
export type ComponentRecord = z.infer<typeof ComponentRecord>

export const MissingDataRule = z.enum(['NOTE', 'OMIT', 'BLOCK'])

export const TemplateSection = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,60}$/),
    componentKey: Key,
    componentVersion: z.number().int().min(1),
    enabled: z.boolean(),
    order: z.number().int().min(0),
    heading: z.string().max(160),
    /** En önemli alan: bölümde nelere önem verileceği; `report.compose` prompt'unun girdisi. */
    sectionDescription: z.string().max(4000),
    required: z.boolean(),
    missingDataRule: MissingDataRule,
  })
  .strict()
export type TemplateSection = z.infer<typeof TemplateSection>

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const THEME_TOKENS = ['navy', 'blue', 'ink', 'slate', 'canvas', 'note', 'note-ink', 'alert', 'alert-ink', 'hi', 'hi-line'] as const
export const ThemeToken = z.enum(THEME_TOKENS)

export const TemplateDefinition = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().min(1).max(160),
    description: z.string().max(1000),
    /** Raporun amacı, hedef kitle, ton, genel vurgu. Prompt'a girer. */
    brief: z.string().max(4000),
    theme: z.object({ tokens: z.partialRecord(ThemeToken, Hex) }).strict(),
    shell: z.object({ heading: z.string().max(160), showFooter: z.boolean() }).strict(),
    sections: z.array(TemplateSection).min(1).max(40),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (new Set(t.sections.map((s) => s.id)).size !== t.sections.length) ctx.addIssue({ code: 'custom', path: ['sections'], message: 'Bölüm kimlikleri benzersiz olmalı' })
    for (const s of t.sections) {
      if (s.required && s.missingDataRule === 'OMIT') ctx.addIssue({ code: 'custom', path: ['sections'], message: `"${s.heading || s.componentKey}": zorunlu bölüm atlanamaz (OMIT)` })
    }
  })
export type TemplateDefinition = z.infer<typeof TemplateDefinition>

/** `report.compose` model çıktısı: rapor başlığı + açık bölümlerin slot metinleri. */
export const ComposeModelOutput = z.object({
  headline: z.string().min(1).max(200),
  sections: z.array(
    z.object({
      sectionId: z.string(),
      fields: z.array(z.object({ slot: z.string(), text: z.string().nullable(), items: z.array(z.string()).nullable() })),
    }),
  ),
})
export type ComposeModelOutput = z.infer<typeof ComposeModelOutput>

export const ReportSectionContent = z.object({
  sectionId: z.string(),
  componentKey: z.string(),
  componentVersion: z.number().int(),
  heading: z.string(),
  /** RENDERED: gösterilir; OMITTED: veri yok, kural OMIT; NOTE: eksik veri notu; BLOCKED: kural BLOCK. */
  state: z.enum(['RENDERED', 'OMITTED', 'NOTE', 'BLOCKED']),
  fields: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
})
export type ReportSectionContent = z.infer<typeof ReportSectionContent>
