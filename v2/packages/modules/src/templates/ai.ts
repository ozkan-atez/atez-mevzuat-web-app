import { z } from 'zod'
import { ComponentCategory, ComponentNode, ComponentSlot, THEME_TOKENS, TemplateDefinition, type ComponentDefinition } from '@atez/contracts'
import { PermanentError, toGeminiJsonSchema, type AiCallContext, type AiGateway } from '@atez/platform'
import { loadPrompt } from '../config/loaders'
import { BUILTIN_COMPONENTS } from './builtins'
import { BINDING_CATALOG, SAMPLE_CONTEXT } from './context'
import { ALLOWED_CLASSES, renderComponentPreview, type Shell } from './render'
import { validateComponent } from './validate'

const COMPONENT_PROMPT = 'component-create.v1'
const DESCRIBE_PROMPT = 'template-describe.v1'
const COMPILE_PROMPT = 'template-compile.v1'

/**
 * Gemini yanıt şeması iç içe karmaşık nesnelerde reddediliyor (canlı deneme 2026-10-17:
 * `nodes[].children[]` → 400 INVALID_ARGUMENT). AI çıktısı düz bir node listesidir; container
 * çocukları `parent` (container'ın listedeki sırası) ile gösterilir ve ağacı kod kurar.
 */
const AiNode = ComponentNode.omit({ children: true }).extend({ parent: z.number().int().min(0).nullable() })

/** AI çıktısı: record yerine dizi (Gemini şeması için); tanım kodla kurulur. */
export const ComponentDraftOutput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000),
  category: ComponentCategory,
  nodes: z.array(AiNode).min(1).max(30),
  slots: z.array(ComponentSlot).max(8),
  appliesWhen: z.string().max(400),
  sampleSlots: z.array(z.object({ key: z.string(), text: z.string().nullable(), items: z.array(z.string()).nullable() })),
})
export type ComponentDraftOutput = z.infer<typeof ComponentDraftOutput>

export interface ComponentDraft {
  ok: boolean
  name: string
  description: string
  category: z.infer<typeof ComponentCategory>
  definition: ComponentDefinition | null
  /** Doğrulama geçmese de kullanıcıya gösterilecek ham tanım. */
  rawDefinition: unknown
  issues: string[]
  previewHtml: string | null
  repairRounds: number
  aiCallIds: string[]
}

/** Düz listeden iki seviyeli ağaç: parent'ı geçersiz olan node kök kalır (doğrulama yakalar). */
export function buildTree(nodes: ComponentDraftOutput['nodes']): unknown[] {
  const roots: Record<string, unknown>[] = []
  const byIndex = new Map<number, Record<string, unknown>>()
  nodes.forEach((n, i) => {
    const { parent, ...rest } = n
    const node: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null && v !== undefined))
    if (n.type === 'container') node.children = []
    byIndex.set(i, node)
    const p = parent === null ? undefined : byIndex.get(parent)
    if (p && Array.isArray(p.children)) (p.children as unknown[]).push(node)
    else roots.push(node)
  })
  return roots
}

/** Ağaçtan düz listeye (taslak düzeltmede modele mevcut tanımı aynı biçimde vermek için). */
export function flattenTree(nodes: ComponentDefinition['nodes']): unknown[] {
  const out: unknown[] = []
  for (const n of nodes) {
    const { children, ...rest } = n
    const idx = out.length
    out.push({ ...rest, parent: null })
    for (const c of children ?? []) out.push({ ...c, parent: idx })
  }
  return out
}

const toDefinition = (o: ComponentDraftOutput) => ({
  schemaVersion: 1,
  nodes: buildTree(o.nodes),
  slots: o.slots,
  appliesWhen: o.appliesWhen,
  bindings: [],
  sampleData: { slots: Object.fromEntries(o.sampleSlots.map((s) => [s.key, s.items && s.items.length ? s.items : (s.text ?? '')])) },
})

/**
 * AI ile bileşen oluşturma/düzeltme (§10.1-4): yapılandırılmış prompt; çıktı yalnızca bileşen
 * tanımı. Doğrulama hatasında tek onarım turu. Sonuç taslaktır; kaydetmeyi API yapar.
 */
export class AiStudio {
  constructor(
    private readonly ai: AiGateway,
    private readonly configDir: string,
    private readonly shell: Shell,
  ) {}

  async draftComponent(input: { request: string; base?: { name: string; description: string; category: string; definition: ComponentDefinition } | null; conversation?: { role: 'user' | 'assistant'; content: string }[]; context?: AiCallContext }): Promise<ComponentDraft> {
    const prompt = loadPrompt(this.configDir, COMPONENT_PROMPT)
    const examples = BUILTIN_COMPONENTS.filter((b) => ['ozet', 'karsilastirma-tablosu', 'etkilenenler'].includes(b.key)).map((b) => ({ name: b.name, description: b.description, category: b.category, definition: { ...b.definition, nodes: flattenTree(b.definition.nodes) } }))
    const payload = {
      istek: input.request,
      mevcutTaslak: input.base ? { ...input.base, definition: { ...input.base.definition, nodes: flattenTree(input.base.definition.nodes) } } : null,
      sohbet: input.conversation ?? [],
      nodeŞeması: toGeminiJsonSchema(ComponentDraftOutput, { relax: true }),
      izinliSınıflar: [...ALLOWED_CLASSES],
      temaTokenları: THEME_TOKENS,
      veriBağları: BINDING_CATALOG,
      örnekler: examples,
    }
    const aiCallIds: string[] = []
    const call = async (extra?: string) => {
      const res = await this.ai.generate({
        tier: 'main',
        purpose: 'component.create',
        promptVersion: prompt.ref,
        system: prompt.text,
        parts: [{ text: `${JSON.stringify(payload)}${extra ? `\n\n${extra}` : ''}\n\nBileşen tanımını üret.` }],
        schema: ComponentDraftOutput,
        relaxSchema: true,
        context: input.context,
      })
      aiCallIds.push(res.aiCallId)
      return res.data
    }
    let out = await call()
    let v = validateComponent(toDefinition(out))
    let repairRounds = 0
    if (!v.ok) {
      repairRounds = 1
      out = await call(`Önceki taslak doğrulamadan geçmedi. Önceki taslak: ${JSON.stringify(out)}\nHatalar:\n${v.issues.map((i) => `- ${i}`).join('\n')}\nHepsini düzelterek yeniden üret.`)
      v = validateComponent(toDefinition(out))
    }
    return {
      ok: v.ok,
      name: out.name,
      description: out.description,
      category: out.category,
      definition: v.definition,
      rawDefinition: toDefinition(out),
      issues: v.issues,
      previewHtml: v.definition ? renderComponentPreview(this.shell, out.name, v.definition, SAMPLE_CONTEXT) : null,
      repairRounds,
      aiCallIds,
    }
  }

  /** Brief'ten bölüm açıklaması önerir; yapı (bölümler, sıra, bileşenler) değişmez. */
  async suggestSectionDescriptions(input: {
    template: TemplateDefinition
    components: Record<string, { name: string; description: string; slots: { key: string; instruction: string }[] }>
    context?: AiCallContext
  }): Promise<{ suggestions: { sectionId: string; sectionDescription: string }[]; aiCallId: string }> {
    const prompt = loadPrompt(this.configDir, DESCRIBE_PROMPT)
    const sections = input.template.sections
      .filter((s) => s.enabled)
      .map((s) => ({ sectionId: s.id, başlık: s.heading, mevcutAçıklama: s.sectionDescription, bileşen: input.components[s.componentKey] ?? null }))
    if (!sections.length) throw new PermanentError('Açık bölüm yok', 'NO_SECTIONS')
    const res = await this.ai.generate({
      tier: 'main',
      purpose: 'template.describe',
      promptVersion: prompt.ref,
      system: prompt.text,
      parts: [{ text: JSON.stringify({ brief: input.template.brief, başlık: input.template.title, bölümler: sections }) }],
      schema: z.object({ sections: z.array(z.object({ sectionId: z.string(), sectionDescription: z.string().max(4000) })) }),
      context: input.context,
    })
    const ids = new Set(sections.map((s) => s.sectionId))
    return { suggestions: res.data.sections.filter((s) => ids.has(s.sectionId)), aiCallId: res.aiCallId }
  }

  /**
   * Kullanıcının serbest rapor tarifini sistem biçimine çevirir: brief + seçili her bölüm için
   * başlık, açıklama ve eksik veri kuralı. Bileşen seçimi ve sıra kullanıcıdadır; çeviri değiştirmez.
   */
  async compileRequest(input: {
    template: TemplateDefinition
    components: Record<string, { name: string; description: string; slots: { key: string; instruction: string }[] }>
    context?: AiCallContext
  }): Promise<CompiledTemplate & { aiCallId: string }> {
    const request = input.template.request?.trim()
    if (!request) throw new PermanentError('Rapor tarifi boş', 'NO_REQUEST')
    const prompt = loadPrompt(this.configDir, COMPILE_PROMPT)
    const sections = [...input.template.sections]
      .filter((s) => s.enabled)
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ sectionId: s.id, mevcutBaşlık: s.heading, zorunlu: s.required, bileşen: input.components[s.componentKey] ?? null }))
    if (!sections.length) throw new PermanentError('Açık bölüm yok', 'NO_SECTIONS')
    const res = await this.ai.generate({
      tier: 'main',
      purpose: 'template.compile',
      promptVersion: prompt.ref,
      system: prompt.text,
      parts: [{ text: JSON.stringify({ şablonAdı: input.template.title, raporTarifi: request, bölümler: sections }) }],
      schema: z.object({
        brief: z.string().max(4000),
        sections: z.array(z.object({ sectionId: z.string(), heading: z.string().max(160), sectionDescription: z.string().max(4000), missingDataRule: z.enum(['NOTE', 'OMIT']) })),
      }),
      context: input.context,
    })
    const ids = new Set(sections.map((s) => s.sectionId))
    return { brief: res.data.brief, sections: res.data.sections.filter((s) => ids.has(s.sectionId)), aiCallId: res.aiCallId }
  }
}

/** Rapor tarifinin çevrilmiş hali: brief + açık bölümlerin başlık/açıklama/eksik veri kuralı. */
export interface CompiledTemplate {
  brief: string
  sections: { sectionId: string; heading: string; sectionDescription: string; missingDataRule: 'NOTE' | 'OMIT' }[]
}

/** Çeviriyi şablona uygular: bileşen seçimi, sıra ve zorunluluk değişmez; zorunlu bölüm OMIT olamaz. */
export function applyCompiled(t: TemplateDefinition, c: CompiledTemplate): TemplateDefinition {
  const map = new Map(c.sections.map((s) => [s.sectionId, s]))
  return TemplateDefinition.parse({
    ...t,
    brief: c.brief,
    sections: t.sections.map((s) => {
      const x = map.get(s.id)
      if (!x || !s.enabled) return s
      return { ...s, heading: x.heading.trim() || s.heading, sectionDescription: x.sectionDescription, missingDataRule: s.required ? 'NOTE' : x.missingDataRule }
    }),
  })
}

/** Öneriyi şablona uygular: yalnızca açıklamalar değişir. */
export function applyDescriptions(t: TemplateDefinition, suggestions: { sectionId: string; sectionDescription: string }[]): TemplateDefinition {
  const map = new Map(suggestions.map((s) => [s.sectionId, s.sectionDescription]))
  return TemplateDefinition.parse({ ...t, sections: t.sections.map((s) => (map.has(s.id) ? { ...s, sectionDescription: map.get(s.id)! } : s)) })
}
