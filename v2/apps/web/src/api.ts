import type { ComponentDefinition, ComponentRecord, TemplateDefinition } from '@atez/contracts'

export type Component = ComponentRecord & { usage: number }
export interface ComponentDetail extends ComponentRecord {
  usage: number
  versions: { version: number; note: string | null; createdAt: string; definition: ComponentDefinition }[]
}
export interface TemplateRow {
  id: string
  title: string
  isDefault: boolean
  currentVersion: number
  updatedAt: string
}
export interface TemplateFull {
  id: string
  isDefault: boolean
  version: number
  versionId: string
  definition: TemplateDefinition
  versions: { id: string; version: number; createdAt: string }[]
}
export interface Draft {
  ok: boolean
  name: string
  description: string
  category: ComponentRecord['category']
  definition: ComponentDefinition | null
  rawDefinition: unknown
  issues: string[]
  previewHtml: string | null
  repairRounds: number
}
export interface Binding {
  path: string
  type: string
  label: string
  item?: { path: string; type: string; label: string }[]
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: string[] = [],
  ) {
    super(message)
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string; issues?: unknown[] }
  if (!res.ok) {
    const issues = (json.issues ?? []).map((i) => (typeof i === 'string' ? i : JSON.stringify(i)))
    throw new ApiError(json.message ?? json.error ?? `HTTP ${res.status}`, res.status, issues)
  }
  return json as T
}

export const api = {
  components: (q: Record<string, string>) => call<Component[]>('GET', `/components?${new URLSearchParams(Object.entries(q).filter(([, v]) => v))}`),
  component: (id: string) => call<ComponentDetail>('GET', `/components/${id}`),
  componentPreview: (id: string, version?: number) => call<{ html: string }>('GET', `/components/${id}/preview${version ? `?version=${version}` : ''}`),
  validateComponent: (name: string, definition: unknown) => call<{ ok: boolean; issues: string[]; html: string | null }>('POST', '/components/validate', { name, definition }),
  createComponent: (b: { name: string; description: string; category: string; origin: 'USER' | 'AI'; definition: unknown; activate: boolean }) => call<ComponentRecord>('POST', '/components', b),
  addVersion: (id: string, b: { definition: unknown; note?: string }) => call<ComponentRecord>('POST', `/components/${id}/versions`, b),
  setStatus: (id: string, status: 'ACTIVE' | 'INACTIVE') => call<{ ok: true }>('PATCH', `/components/${id}`, { status }),
  removeComponent: (id: string) => call<{ result: 'DELETED' | 'ARCHIVED'; usage: number }>('DELETE', `/components/${id}`),
  draft: (b: { request: string; base?: { name: string; description: string; category: string; definition: ComponentDefinition } | null; conversation?: { role: 'user' | 'assistant'; content: string }[] }) =>
    call<Draft>('POST', '/components/ai/draft', b),
  bindings: () => call<Binding[]>('GET', '/bindings'),
  templates: () => call<TemplateRow[]>('GET', '/templates'),
  template: (id: string) => call<TemplateFull>('GET', `/templates/${id}`),
  createTemplate: (b: { title: string; description?: string; brief?: string }) => call<{ id: string }>('POST', '/templates', b),
  saveTemplate: (id: string, definition: TemplateDefinition) => call<{ version: number }>('PUT', `/templates/${id}`, { definition }),
  setDefault: (id: string) => call<{ ok: true }>('POST', `/templates/${id}/default`),
  previewTemplate: (definition: TemplateDefinition) => call<{ html: string; sections: { id: string; state: string }[] }>('POST', '/templates/preview', { definition }),
  describe: (definition: TemplateDefinition) => call<{ suggestions: { sectionId: string; sectionDescription: string }[] }>('POST', '/templates/ai/describe', { definition }),
}

export const CATEGORY_LABELS: Record<string, string> = {
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
export const ORIGIN_LABELS: Record<string, string> = { BUILTIN: 'Yerleşik', USER: 'Kullanıcı', AI: 'AI' }
export const STATUS_LABELS: Record<string, string> = { ACTIVE: 'Aktif', INACTIVE: 'Pasif', ARCHIVED: 'Arşiv' }
