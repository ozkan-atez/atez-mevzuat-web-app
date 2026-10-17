/** v2 şablon stüdyosu türleri (v2/packages/contracts/src/templates.ts ile aynı biçim). */
export type ComponentCategory = 'BASLIK' | 'OZET' | 'DEGISIKLIK_KARTI' | 'KARSILASTIRMA_TABLOSU' | 'GTIP_TABLOSU' | 'ZAMAN_CIZELGESI' | 'ETKILENENLER' | 'KAYNAKLAR' | 'NOT_UYARI'
export type ComponentOrigin = 'BUILTIN' | 'USER' | 'AI'
export type ComponentStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'

export interface ComponentSlot { key: string; kind: 'text' | 'list'; instruction: string }
export interface ComponentDefinition {
  schemaVersion: 1
  nodes: unknown[]
  slots: ComponentSlot[]
  appliesWhen: string
  bindings: string[]
  sampleData: { slots: Record<string, string | string[]> }
}
export interface StudioComponent {
  id: string
  key: string
  name: string
  description: string
  category: ComponentCategory
  origin: ComponentOrigin
  status: ComponentStatus
  currentVersion: number
  definition: ComponentDefinition
  usage?: number
}
export interface StudioComponentDetail extends StudioComponent {
  usage: number
  versions: { version: number; note: string | null; createdAt: string; definition: ComponentDefinition }[]
}
export type MissingDataRule = 'NOTE' | 'OMIT'
export interface TemplateSectionV2 {
  id: string
  componentKey: string
  componentVersion: number
  enabled: boolean
  order: number
  heading: string
  sectionDescription: string
  required: boolean
  missingDataRule: MissingDataRule
}
export interface TemplateDefinitionV2 {
  schemaVersion: 1
  title: string
  description: string
  brief: string
  /** Kullanıcının serbest rapor tarifi; kaydederken brief + bölüm açıklamalarına çevrilir. */
  request?: string
  theme: { tokens: Record<string, string> }
  shell: { heading: string; showFooter: boolean }
  sections: TemplateSectionV2[]
}
export interface TemplateRowV2 { id: string; title: string; description?: string; sectionCount?: number; isDefault: boolean; currentVersion: number; updatedAt: string }
export interface TemplateFullV2 { id: string; isDefault: boolean; version: number; versionId: string; definition: TemplateDefinitionV2; versions: { id: string; version: number; createdAt: string }[] }
export interface ComponentDraft {
  ok: boolean
  name: string
  description: string
  category: ComponentCategory
  definition: ComponentDefinition | null
  rawDefinition: unknown
  issues: string[]
  previewHtml: string | null
  repairRounds: number
}

export const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  BASLIK: 'Başlık',
  OZET: 'Özet',
  DEGISIKLIK_KARTI: 'Değişiklik kartı',
  KARSILASTIRMA_TABLOSU: 'Karşılaştırma tablosu',
  GTIP_TABLOSU: 'GTİP tablosu',
  ZAMAN_CIZELGESI: 'Zaman çizelgesi / yürürlük',
  ETKILENENLER: 'Etkilenenler',
  KAYNAKLAR: 'Kaynaklar',
  NOT_UYARI: 'Not / uyarı',
}
export const ORIGIN_LABELS: Record<ComponentOrigin, string> = { BUILTIN: 'Yerleşik', USER: 'Kullanıcı', AI: 'AI' }
export const STATUS_LABELS: Record<ComponentStatus, string> = { ACTIVE: 'Aktif', INACTIVE: 'Pasif', ARCHIVED: 'Arşiv' }
export const MISSING_RULE_LABELS: Record<MissingDataRule, string> = { NOTE: '“Kaynakta yok” notu', OMIT: 'Bölümü gizle' }
export interface CompiledTemplateV2 {
  brief: string
  sections: { sectionId: string; heading: string; sectionDescription: string; missingDataRule: MissingDataRule }[]
}
