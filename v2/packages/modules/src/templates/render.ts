import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { evaluate } from '@marcbachmann/cel-js'
import type { ComponentDefinition, ComponentNode, LeafNode, ReportSectionContent, TemplateDefinition } from '@atez/contracts'
import { sha256 } from '@atez/platform'
import { formatTr } from '../reporting/numbers'
import { fmtDate, getPath, type RenderContext } from './context'

/** Node'ların kullanabileceği CSS sınıfları (bulten-v2 kataloğu + stüdyo eklemeleri). Inline stil yoktur. */
export const ALLOWED_CLASSES = new Set([
  'block', 'note', 'note--alert', 'badge', 'badge--alert', 'badge--info', 'metadata', 'label', 'title-value', 'rule',
  'chip', 'chip--official', 'chip--supporting', 'compare', 'compare-cell', 'is-new', 'timeline', 'timeline-row', 'timeline-date',
  'timeline-text', 'empty-state', 'empty-title', 'info-mark', 'info-box', 'table-section', 'table-intro', 'table-scroll', 'data-table',
  'data-table--wide', 'data-table--plain', 'table-notes', 'source', 'source-label', 'is-emphasis', 'grid-2', 'lead', 'section-note',
])

export type Slots = Record<string, string | string[]>

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const cls = (base: string[], extra?: string[]) => {
  const list = [...base, ...(extra ?? []).filter((c) => ALLOWED_CLASSES.has(c))]
  return list.length ? ` class="${esc(list.join(' '))}"` : ''
}
const safeUrl = (u: unknown) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null)

export function formatValue(v: unknown, format: string | undefined): string {
  if (v === null || v === undefined || v === '') return '—'
  switch (format) {
    case 'number':
      return formatTr(String(v))
    case 'percent': {
      const s = String(v)
      return `${s.startsWith('-') ? '' : '+'}%${formatTr(s)}`
    }
    case 'date':
      return fmtDate(v)
    default:
      return String(v)
  }
}

/** Bir node'un metni: sabit metin, veri bağı veya slot (compose'un yazdığı alan). */
function textOf(node: { text?: string; bind?: string; slot?: string; format?: string }, ctx: RenderContext, slots: Slots): string {
  if (node.slot) {
    const v = slots[node.slot]
    return Array.isArray(v) ? v.join(' ') : (v ?? '')
  }
  if (node.bind) return formatValue(getPath(ctx, node.bind), node.format ?? 'text')
  return node.text ?? ''
}

function listOf(node: LeafNode, ctx: RenderContext, slots: Slots): string[] {
  if (node.slot) {
    const v = slots[node.slot]
    return Array.isArray(v) ? v : v ? [v] : []
  }
  if (node.bind) {
    const v = getPath(ctx, node.bind)
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' && 'text' in x ? String((x as { text: unknown }).text) : String(x)))
  }
  return []
}

function renderLeaf(node: LeafNode, ctx: RenderContext, slots: Slots): string {
  switch (node.type) {
    case 'heading': {
      const t = textOf(node, ctx, slots)
      const tag = node.level === 3 ? 'h3' : 'h2'
      return t ? `<${tag}${cls([], node.classes)}>${esc(t)}</${tag}>` : ''
    }
    case 'text': {
      const t = textOf(node, ctx, slots)
      if (!t) return node.emptyText ? `<p class="section-note">${esc(node.emptyText)}</p>` : ''
      return `<p${cls([], node.classes)}>${esc(t).replace(/\n/g, '<br>')}</p>`
    }
    case 'badge': {
      const t = textOf(node, ctx, slots)
      const variant = node.variant === 'alert' ? ['badge--alert'] : node.variant === 'info' ? ['badge--info'] : []
      return t ? `<span${cls(['badge', ...variant], node.classes)}>${esc(t)}</span>` : ''
    }
    case 'list': {
      const items = listOf(node, ctx, slots)
      if (!items.length) return node.emptyText ? `<p class="section-note">${esc(node.emptyText)}</p>` : ''
      return `${node.label ? `<h3>${esc(node.label)}</h3>` : ''}<ul${cls([], node.classes)}>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
    }
    case 'metadata':
      return `<div${cls(['metadata'], node.classes)}>${(node.rows ?? [])
        .map((r) => `<span class="label">${esc(r.label)}</span><span class="title-value">${esc(formatValue(getPath(ctx, r.bind), r.format))}</span>`)
        .join('')}</div>`
    case 'table': {
      const rows = node.bind ? getPath(ctx, node.bind) : []
      if (!Array.isArray(rows) || !rows.length) return node.emptyText ? `<p class="section-note">${esc(node.emptyText)}</p>` : ''
      const cols = node.columns ?? []
      const head = cols.map((c) => `<th>${esc(c.header)}</th>`).join('')
      const body = rows
        .map(
          (row) =>
            `<tr>${cols
              .map((c) => {
                const v = getPath(row, c.value)
                const change = c.format === 'percent' && typeof v === 'string' ? (v.startsWith('-') ? ' class="change-down"' : ' class="change-up"') : ''
                return `<td${change}>${esc(formatValue(v, c.format))}</td>`
              })
              .join('')}</tr>`,
        )
        .join('')
      return `<div class="table-section">${node.label ? `<h2>${esc(node.label)}</h2>` : ''}<div class="table-scroll"><table${cls(['data-table'], node.classes)}><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`
    }
    case 'compare': {
      const side = (s: NonNullable<LeafNode['before']>, isNew: boolean) =>
        `<div class="compare-cell${isNew ? ' is-new' : ''}"><h3>${esc(s.label)}</h3><p>${esc(s.slot ? textOf({ slot: s.slot }, ctx, slots) : s.bind ? formatValue(getPath(ctx, s.bind), node.format) : (s.text ?? ''))}</p></div>`
      return node.before && node.after ? `<div${cls(['compare'], node.classes)}>${side(node.before, false)}${side(node.after, true)}</div>` : ''
    }
    case 'timeline': {
      const rows = node.bind ? getPath(ctx, node.bind) : []
      if (!Array.isArray(rows) || !rows.length) return node.emptyText ? `<p class="section-note">${esc(node.emptyText)}</p>` : ''
      return `<div${cls(['timeline'], node.classes)}>${rows
        .map((r) => `<div class="timeline-row"><span class="timeline-date">${esc(fmtDate(getPath(r, node.date ?? 'date')) || '—')}</span><span class="timeline-text">${esc(getPath(r, node.itemText ?? 'label') ?? '')}</span></div>`)
        .join('')}</div>`
    }
    case 'note': {
      const t = textOf(node, ctx, slots)
      if (!t) return ''
      return `<div${cls(['note', ...(node.variant === 'alert' ? ['note--alert'] : [])], node.classes)}>${node.label ? `<h2>${esc(node.label)}</h2>` : ''}<p>${esc(t)}</p></div>`
    }
    case 'sources': {
      const docs = node.bind ? getPath(ctx, node.bind) : []
      if (!Array.isArray(docs) || !docs.length) return ''
      return docs
        .map((d) => {
          const doc = d as { title?: string; url?: string | null; roleLabel?: string; publicationDate?: string | null }
          const url = safeUrl(doc.url)
          const title = url ? `<a href="${esc(url)}" rel="noreferrer">${esc(doc.title)}</a>` : esc(doc.title)
          return `<div${cls(['source'], node.classes)}><span class="source-label">${esc(doc.roleLabel ?? 'Kaynak')}:</span>${title}<span class="source-label">${esc(fmtDate(doc.publicationDate))}</span></div>`
        })
        .join('')
    }
    case 'divider':
      return '<div class="rule"></div>'
    default:
      return ''
  }
}

export function renderNode(node: ComponentNode, ctx: RenderContext, slots: Slots): string {
  if (node.type === 'container') return `<div${cls(['block'], node.classes)}>${(node.children ?? []).map((c) => renderLeaf(c, ctx, slots)).join('')}</div>`
  return renderLeaf(node as LeafNode, ctx, slots)
}

export function renderComponent(def: ComponentDefinition, ctx: RenderContext, slots: Slots): string {
  return def.nodes.map((n) => renderNode(n, ctx, slots)).join('')
}

/** CEL görünme kuralı; boşsa her zaman görünür. Hata → görünmez + sebep. */
export function appliesTo(def: ComponentDefinition, ctx: RenderContext): { visible: boolean; error: string | null } {
  if (!def.appliesWhen.trim()) return { visible: true, error: null }
  try {
    return { visible: evaluate(def.appliesWhen, ctx as unknown as Record<string, unknown>) === true, error: null }
  } catch (err) {
    return { visible: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---- Sayfa iskeleti -------------------------------------------------------------

export interface Shell {
  css: string
  logoDataUri: string
  ref: string
}

export function loadShell(configDir: string): Shell {
  const css = readFileSync(join(configDir, 'templates', 'bulten-v2.css'), 'utf8')
  const logo = readFileSync(join(configDir, 'templates', 'assets', 'atez-logo.png'))
  return { css, logoDataUri: `data:image/png;base64,${logo.toString('base64')}`, ref: `bulten-v2@${sha256(css + logo.length).slice(0, 8)}` }
}

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;">`

function themeCss(template: Pick<TemplateDefinition, 'theme'>): string {
  const vars = Object.entries(template.theme.tokens)
    .filter(([, v]) => /^#[0-9a-fA-F]{6}$/.test(v))
    .map(([k, v]) => `--${k}:${v};`)
    .join('')
  return vars ? `:root{${vars}}` : ''
}

export interface PageMeta {
  reportLabel: string
  headline: string
  sourceLabel: string
  displayDate: string
  preview?: boolean
}

export function renderPage(shell: Shell, template: Pick<TemplateDefinition, 'theme' | 'shell'>, bodyHtml: string, meta: PageMeta): string {
  const footer = template.shell.showFooter
    ? `<section class="fine"><div class="rule"></div><h2>Kaynak sınıflandırma sistemi</h2><p>ATEZ Mevzuat Bülteni resmî kaynaklar ve açıkça belirtilen destekleyici kaynaklardan derlenir. Destekleyici kaynaklar bağlayıcı mevzuat hükmü olarak değerlendirilmez.</p><h2>Yasal uyarı / sorumluluk reddi</h2><p>Bu bültende yer alan bildirimler yalnızca bilgilendirme amaçlıdır; hukuki tavsiye niteliği taşımaz. Resmî süreçlerde Resmî Gazete’de yayımlanan özgün metinler esas alınmalıdır.</p></section>
    <footer class="footer"><div class="footer-top"><h2 class="footer-head">İletişim &amp; destek</h2><p>mevzuat@atezyazilim.com</p></div><div class="footer-rule"></div><div class="footer-bottom"><div class="links"><span>Web Sitemiz</span><span>Gizlilik Politikası</span><span>Abonelikten Çık</span></div><p class="copyright">© 2026 Atez Yazılım Teknolojileri A.Ş.</p></div></footer>`
    : ''
  return `<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">${CSP}<title>${esc(meta.headline)}</title>
<style>${shell.css}${themeCss(template)}</style></head>
<body><main class="report">
<header><div class="topbar"><img class="logo" src="${shell.logoDataUri}" alt="ATEZ"><span class="report-id">${esc(meta.reportLabel)}</span></div>
<div class="header"><div class="header-grid"><h1 class="report-title">${esc(template.shell.heading)}</h1><div class="issue"><div>${esc(meta.sourceLabel)}</div><div class="date"><span>${esc(meta.displayDate)}</span></div></div></div></div></header>
<section class="feed"><article class="card">${meta.preview ? '<p class="section-note">Tasarım önizlemesi · örnek veri</p>' : ''}<h2 class="headline">${esc(meta.headline)}</h2>${bodyHtml}</article></section>
${footer}
</main></body></html>`
}

export function renderSection(section: Pick<ReportSectionContent, 'heading' | 'state' | 'fields'>, def: ComponentDefinition | null, ctx: RenderContext): string {
  const heading = section.heading ? `<h2>${esc(section.heading)}</h2>` : ''
  if (section.state === 'OMITTED') return ''
  if (section.state === 'NOTE') return `<div class="rule"></div><section class="block">${heading}<p class="section-note">Bu bilgi kaynakta yer almıyor.</p></section>`
  return `<div class="rule"></div><section class="block">${heading}${def ? renderComponent(def, ctx, section.fields) : ''}</section>`
}

/** Tek bileşen önizlemesi: aynı tema ve iskeletle, kart içinde. */
export function renderComponentPreview(shell: Shell, name: string, def: ComponentDefinition, ctx: RenderContext, slots?: Slots): string {
  const body = renderSection({ heading: name, state: 'RENDERED', fields: slots ?? def.sampleData.slots }, def, ctx)
  return `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">${CSP}<style>${shell.css}html,body{background:#fff!important}.preview{padding:16px}.preview .card{border:0;padding:4px}.preview .rule:first-child{display:none}</style></head><body><main class="preview"><article class="card">${body}</article></main></body></html>`
}
