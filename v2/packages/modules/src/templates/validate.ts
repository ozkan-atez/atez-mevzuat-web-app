import { ComponentDefinition, type ComponentNode, type LeafNode } from '@atez/contracts'
import { BINDING_CATALOG, SAMPLE_CONTEXT, bindingInfo } from './context'
import { ALLOWED_CLASSES, appliesTo, renderComponent } from './render'

export const COMPONENT_LIMITS = { maxBytes: 16_000, maxNodes: 40 }

export interface ComponentValidation {
  ok: boolean
  issues: string[]
  /** Normalize edilmiş tanım (bindings kodla hesaplanır). */
  definition: ComponentDefinition | null
  previewHtml: string | null
}

const SCALAR = new Set(['string', 'date'])

/**
 * Bileşen doğrulaması (§10.1): şema; izinli node, sınıf ve token; bağlanan alanların katalogda
 * var olması; slot bütünlüğü; boyut; CEL kuralı ve örnek veriyle hatasız render.
 */
export function validateComponent(raw: unknown): ComponentValidation {
  const parsed = ComponentDefinition.safeParse(raw)
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'tanım'}: ${i.message}`), definition: null, previewHtml: null }
  const def = parsed.data
  const issues: string[] = []
  const used = new Set<string>()
  const slotUse = new Map<string, 'text' | 'list'>()
  let count = 0

  const checkBind = (where: string, path: string | undefined, kinds: string[]) => {
    if (!path) return
    const info = bindingInfo(path)
    if (!info) return issues.push(`${where}: "${path}" analizde yok`)
    if (!kinds.includes(info.type)) issues.push(`${where}: "${path}" türü ${info.type}, burada ${kinds.join('/')} bekleniyor`)
    used.add(path)
  }
  const checkItem = (where: string, arrayPath: string | undefined, rel: string | undefined) => {
    if (!arrayPath || !rel) return
    const info = bindingInfo(arrayPath)
    if (info?.type === 'array' && !info.item?.some((i) => i.path === rel)) issues.push(`${where}: "${arrayPath}" satırında "${rel}" alanı yok`)
  }
  const source = (where: string, n: { text?: string; bind?: string; slot?: string }, kinds = ['string', 'date'], slotKind: 'text' | 'list' = 'text') => {
    const sources = [n.text, n.bind, n.slot].filter((x) => x !== undefined && x !== '').length
    if (sources !== 1) issues.push(`${where}: metin için tam olarak bir kaynak gerekli (text, bind ya da slot)`)
    checkBind(where, n.bind, kinds)
    if (n.slot) slotUse.set(n.slot, slotKind)
  }

  const visit = (n: ComponentNode | LeafNode, where: string, nested: boolean) => {
    count++
    for (const c of n.classes ?? []) if (!ALLOWED_CLASSES.has(c)) issues.push(`${where}: izinli olmayan sınıf "${c}"`)
    if (n.type !== 'container' && 'children' in n && n.children) issues.push(`${where}: yalnızca container çocuk içerebilir`)
    switch (n.type) {
      case 'container':
        if (nested) issues.push(`${where}: container iç içe kullanılamaz`)
        if (!('children' in n) || !n.children?.length) issues.push(`${where}: container boş`)
        ;('children' in n ? n.children ?? [] : []).forEach((c, i) => visit(c, `${where}.children[${i}]`, true))
        break
      case 'heading':
      case 'text':
      case 'badge':
      case 'note':
        source(where, n)
        break
      case 'list':
        if ((n.bind ? 1 : 0) + (n.slot ? 1 : 0) !== 1) issues.push(`${where}: liste için bind ya da slot gerekli`)
        checkBind(where, n.bind, ['string[]', 'array'])
        if (n.bind && bindingInfo(n.bind)?.type === 'array' && !bindingInfo(n.bind)?.item?.some((i) => i.path === 'text')) issues.push(`${where}: "${n.bind}" metin listesi değil`)
        if (n.slot) slotUse.set(n.slot, 'list')
        break
      case 'metadata':
        if (!n.rows?.length) issues.push(`${where}: metadata satırı yok`)
        n.rows?.forEach((r, i) => checkBind(`${where}.rows[${i}]`, r.bind, [...SCALAR]))
        break
      case 'table':
        checkBind(where, n.bind, ['array'])
        if (!n.columns?.length) issues.push(`${where}: tablo sütunu yok`)
        n.columns?.forEach((c, i) => checkItem(`${where}.columns[${i}]`, n.bind, c.value))
        break
      case 'compare':
        if (!n.before || !n.after) issues.push(`${where}: compare için before ve after gerekli`)
        for (const [k, s] of [['before', n.before], ['after', n.after]] as const) if (s) source(`${where}.${k}`, s)
        break
      case 'timeline':
        checkBind(where, n.bind, ['array'])
        checkItem(where, n.bind, n.date ?? 'date')
        checkItem(where, n.bind, n.itemText ?? 'label')
        break
      case 'sources':
        if (n.bind !== 'analysis.documents') issues.push(`${where}: sources yalnızca analysis.documents'a bağlanır`)
        else used.add(n.bind)
        break
      case 'divider':
        break
    }
  }
  def.nodes.forEach((n, i) => visit(n, `nodes[${i}]`, false))

  const declared = new Map(def.slots.map((s) => [s.key, s.kind]))
  for (const [k, kind] of slotUse) {
    if (!declared.has(k)) issues.push(`slot "${k}" tanımlanmamış`)
    else if (declared.get(k) !== kind) issues.push(`slot "${k}" türü ${declared.get(k)}, kullanım ${kind}`)
  }
  for (const s of def.slots) {
    if (!slotUse.has(s.key)) issues.push(`slot "${s.key}" hiçbir node'da kullanılmıyor`)
    const sample = def.sampleData.slots[s.key]
    if (sample === undefined) issues.push(`slot "${s.key}" için örnek veri yok`)
    else if ((s.kind === 'list') !== Array.isArray(sample)) issues.push(`slot "${s.key}" örnek verisi ${s.kind} türünde olmalı`)
  }
  if (count > COMPONENT_LIMITS.maxNodes) issues.push(`en fazla ${COMPONENT_LIMITS.maxNodes} node`)
  if (JSON.stringify(def).length > COMPONENT_LIMITS.maxBytes) issues.push(`tanım ${COMPONENT_LIMITS.maxBytes} baytı aşıyor`)

  const rule = appliesTo(def, SAMPLE_CONTEXT)
  if (rule.error) issues.push(`appliesWhen geçersiz: ${rule.error}`)

  const normalized: ComponentDefinition = { ...def, bindings: [...used].sort() }
  let previewHtml: string | null = null
  try {
    previewHtml = renderComponent(normalized, SAMPLE_CONTEXT, normalized.sampleData.slots)
    if (!previewHtml.trim()) issues.push('örnek veriyle render boş sonuç verdi')
  } catch (err) {
    issues.push(`örnek veriyle render hatası: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { ok: issues.length === 0, issues, definition: issues.length ? null : normalized, previewHtml }
}

export const BINDING_PATHS = BINDING_CATALOG.map((b) => b.path)
