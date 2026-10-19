import { apiFetch } from '../../lib/apiFetch'
import type { CompiledTemplateV2, ComponentDefinition, ComponentDraft, StudioComponent, StudioComponentDetail, TemplateDefinitionV2, TemplateFullV2, TemplateRowV2 } from './studio-types'

/** Şablon stüdyosu istemcisi. /api/v2 adresleri ana API içindeki gömülü stüdyoya gider. */
export class StudioRequestError extends Error {
  readonly status: number
  readonly issues: string[]
  constructor(status: number, message: string, issues: string[] = []) {
    super(message)
    this.status = status
    this.issues = issues
  }
}

export async function studioRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(`/api/v2/${path}`, { ...init, headers: { ...(init.body != null ? { 'Content-Type': 'application/json' } : {}), ...init.headers } }, { notifyAuth: false })
  const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string; issues?: unknown[] }
  if (!res.ok) {
    const issues = (body.issues ?? []).map((i) => (typeof i === 'string' ? i : JSON.stringify(i)))
    const message = body.error === 'AI_NOT_CONFIGURED' ? 'AI yapılandırılmamış.' : body.error === 'VALIDATION_FAILED' ? 'Doğrulama başarısız.' : (body.message ?? body.error ?? 'İşlem tamamlanamadı.')
    throw new StudioRequestError(res.status, message, issues)
  }
  return body as T
}
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

export const studioApi = {
  components: (q: { category?: string; status?: string; origin?: string } = {}) =>
    studioRequest<StudioComponent[]>(`components?${new URLSearchParams(Object.entries(q).filter(([, v]) => !!v) as [string, string][])}`),
  component: (id: string) => studioRequest<StudioComponentDetail>(`components/${id}`),
  componentPreview: (id: string, version?: number) => studioRequest<{ html: string }>(`components/${id}/preview${version ? `?version=${version}` : ''}`),
  addComponentVersion: (id: string, b: { definition: unknown; note?: string; name?: string; description?: string }) => studioRequest<StudioComponent>(`components/${id}/versions`, json('POST', b)),
  createComponent: (b: { key?: string; name: string; description: string; category: string; origin: 'USER' | 'AI'; definition: unknown; activate: boolean }) => studioRequest<StudioComponent>('components', json('POST', b)),
  setStatus: (id: string, status: 'ACTIVE' | 'INACTIVE') => studioRequest<{ ok: true }>(`components/${id}`, json('PATCH', { status })),
  removeComponent: (id: string) => studioRequest<{ result: 'DELETED' | 'ARCHIVED'; usage: number }>(`components/${id}`, json('DELETE')),
  draftComponent: (b: { request: string; base?: { name: string; description: string; category: string; definition: ComponentDefinition } | null; conversation?: { role: 'user' | 'assistant'; content: string }[] }) =>
    studioRequest<ComponentDraft>('components/ai/draft', json('POST', b)),
  templates: () => studioRequest<TemplateRowV2[]>('templates'),
  template: (id: string) => studioRequest<TemplateFullV2>(`templates/${id}`),
  createTemplate: (b: { title: string; description?: string; brief?: string }) => studioRequest<{ id: string }>('templates', json('POST', b)),
  saveTemplate: (id: string, definition: TemplateDefinitionV2) => studioRequest<{ version: number }>(`templates/${id}`, json('PUT', { definition })),
  removeTemplate: (id: string) => studioRequest<{ result: 'ARCHIVED' }>(`templates/${id}`, json('DELETE')),
  setDefault: (id: string) => studioRequest<{ ok: true }>(`templates/${id}/default`, json('POST', {})),
  previewTemplate: (definition: TemplateDefinitionV2) => studioRequest<{ html: string; sections: { id: string; state: string }[] }>('templates/preview', json('POST', { definition })),
  compile: (definition: TemplateDefinitionV2) => studioRequest<{ compiled: CompiledTemplateV2; definition: TemplateDefinitionV2 }>('templates/ai/compile', json('POST', { definition })),
  describe: (definition: TemplateDefinitionV2) => studioRequest<{ suggestions: { sectionId: string; sectionDescription: string }[] }>('templates/ai/describe', json('POST', { definition })),
}
