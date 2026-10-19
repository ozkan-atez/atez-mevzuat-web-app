import { z } from 'zod'
import { TemplateDefinition, type ComponentDefinition } from '@atez/contracts'
import { toGeminiJsonSchema } from '@atez/platform'
import type { AiStudio } from './ai'
import { SAMPLE_CONTEXT } from './context'
import { renderComponentPreview, type Shell } from './render'
import type { ComponentService, TemplateService } from './services'

/**
 * Asistan araç paketi `templates` (§10.1-5, §11). Yan etkili araçlar hiçbir şeyi kaydetmez:
 * `propose_*` bir **aksiyon kartı** döner (canlı önizleme + "Kaydet / Aktifleştir"); kaydı,
 * kullanıcı butona bastığında API yapar. Chat arayüzü kendi aşamasında bağlanır.
 */
export const TemplateToolArgs = {
  list_components: z.object({ category: z.string().optional(), status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional() }),
  preview_component: z.object({ componentId: z.string().uuid(), version: z.number().int().optional() }),
  propose_component: z.object({ request: z.string().min(3).max(2000) }),
  propose_component_change: z.object({ componentId: z.string().uuid(), request: z.string().min(3).max(2000) }),
  list_templates: z.object({}),
  propose_template_change: z.object({
    templateId: z.string().uuid(),
    changes: z
      .array(
        z.object({
          sectionId: z.string(),
          enabled: z.boolean().optional(),
          order: z.number().int().min(0).optional(),
          sectionDescription: z.string().max(4000).optional(),
          heading: z.string().max(160).optional(),
        }),
      )
      .min(1)
      .max(40),
  }),
} as const
export type TemplateToolName = keyof typeof TemplateToolArgs

export const TEMPLATE_TOOLS: { name: TemplateToolName; description: string; sideEffect: boolean; parameters: unknown }[] = [
  { name: 'list_components', description: 'Bileşen havuzunu listeler (ad, kategori, durum, açıklama).', sideEffect: false, parameters: toGeminiJsonSchema(TemplateToolArgs.list_components) },
  { name: 'preview_component', description: 'Bir bileşenin örnek veriyle önizlemesini döner.', sideEffect: false, parameters: toGeminiJsonSchema(TemplateToolArgs.preview_component) },
  { name: 'propose_component', description: 'İstekten AI ile yeni bileşen taslağı üretir; kaydetmez, aksiyon kartı döner.', sideEffect: true, parameters: toGeminiJsonSchema(TemplateToolArgs.propose_component) },
  { name: 'propose_component_change', description: 'Var olan bileşen için değişiklik taslağı (yeni sürüm) üretir; kaydetmez.', sideEffect: true, parameters: toGeminiJsonSchema(TemplateToolArgs.propose_component_change) },
  { name: 'list_templates', description: 'Şablonları ve bölümlerini listeler.', sideEffect: false, parameters: toGeminiJsonSchema(TemplateToolArgs.list_templates) },
  { name: 'propose_template_change', description: 'Şablon bölümlerini aç/kapat, sırala ya da açıklamalarını değiştir; kaydetmez, aksiyon kartı döner.', sideEffect: true, parameters: toGeminiJsonSchema(TemplateToolArgs.propose_template_change) },
]

export type ToolResult =
  | { kind: 'data'; data: unknown }
  | {
      kind: 'action';
      card: {
        action: 'SAVE_COMPONENT' | 'SAVE_COMPONENT_VERSION' | 'SAVE_TEMPLATE'
        title: string
        previewHtml: string | null
        issues: string[]
        /** API'ye aynen gönderilecek gövde; model değil kullanıcı onaylar. */
        payload: unknown
        buttons: ('save' | 'activate' | 'discard')[]
      }
    }

export async function runTemplateTool(
  name: TemplateToolName,
  rawArgs: unknown,
  deps: { components: ComponentService; templates: TemplateService; studio: AiStudio | null; shell: Shell },
): Promise<ToolResult> {
  switch (name) {
    case 'list_components': {
      const a = TemplateToolArgs.list_components.parse(rawArgs ?? {})
      const list = await deps.components.list({ category: a.category, status: a.status })
      return { kind: 'data', data: list.map((c) => ({ id: c.id, key: c.key, name: c.name, category: c.category, status: c.status, origin: c.origin, version: c.currentVersion, description: c.description })) }
    }
    case 'preview_component': {
      const a = TemplateToolArgs.preview_component.parse(rawArgs)
      const c = await deps.components.get(a.componentId)
      if (!c) return { kind: 'data', data: { error: 'Bileşen yok' } }
      const def = (a.version ? c.versions.find((v) => v.version === a.version)?.definition : c.definition) as ComponentDefinition
      return { kind: 'data', data: { name: c.name, version: a.version ?? c.currentVersion, html: renderComponentPreview(deps.shell, c.name, def, SAMPLE_CONTEXT) } }
    }
    case 'propose_component': {
      const a = TemplateToolArgs.propose_component.parse(rawArgs)
      if (!deps.studio) return { kind: 'data', data: { error: 'AI yapılandırılmamış' } }
      const d = await deps.studio.draftComponent({ request: a.request })
      return {
        kind: 'action',
        card: { action: 'SAVE_COMPONENT', title: d.name, previewHtml: d.previewHtml, issues: d.issues, payload: { name: d.name, description: d.description, category: d.category, origin: 'AI', definition: d.definition ?? d.rawDefinition }, buttons: d.ok ? ['save', 'activate', 'discard'] : ['discard'] },
      }
    }
    case 'propose_component_change': {
      const a = TemplateToolArgs.propose_component_change.parse(rawArgs)
      if (!deps.studio) return { kind: 'data', data: { error: 'AI yapılandırılmamış' } }
      const c = await deps.components.get(a.componentId)
      if (!c) return { kind: 'data', data: { error: 'Bileşen yok' } }
      const d = await deps.studio.draftComponent({ request: a.request, base: { name: c.name, description: c.description, category: c.category, definition: c.definition } })
      return {
        kind: 'action',
        card: { action: 'SAVE_COMPONENT_VERSION', title: `${c.name} · yeni sürüm`, previewHtml: d.previewHtml, issues: d.issues, payload: { componentId: c.id, definition: d.definition ?? d.rawDefinition, note: a.request }, buttons: d.ok ? ['save', 'discard'] : ['discard'] },
      }
    }
    case 'list_templates': {
      const list = await deps.templates.list()
      const out = []
      for (const t of list) {
        const full = await deps.templates.get(t.id)
        out.push({ id: t.id, title: t.title, isDefault: t.isDefault, version: t.currentVersion, sections: full?.definition.sections.map((s) => ({ id: s.id, heading: s.heading, enabled: s.enabled, order: s.order, component: s.componentKey })) })
      }
      return { kind: 'data', data: out }
    }
    case 'propose_template_change': {
      const a = TemplateToolArgs.propose_template_change.parse(rawArgs)
      const t = await deps.templates.get(a.templateId)
      if (!t) return { kind: 'data', data: { error: 'Şablon yok' } }
      const byId = new Map(a.changes.map((c) => [c.sectionId, c]))
      const unknown = a.changes.filter((c) => !t.definition.sections.some((s) => s.id === c.sectionId)).map((c) => c.sectionId)
      const next = TemplateDefinition.parse({ ...t.definition, sections: t.definition.sections.map((s) => ({ ...s, ...Object.fromEntries(Object.entries(byId.get(s.id) ?? {}).filter(([k, v]) => k !== 'sectionId' && v !== undefined)) })) })
      const preview = await deps.templates.preview(next, deps.shell)
      return {
        kind: 'action',
        card: { action: 'SAVE_TEMPLATE', title: `${t.definition.title} · değişiklik önerisi`, previewHtml: preview.html, issues: unknown.map((id) => `Bilinmeyen bölüm: ${id}`), payload: { templateId: t.id, definition: next }, buttons: unknown.length ? ['discard'] : ['save', 'discard'] },
      }
    }
  }
}
