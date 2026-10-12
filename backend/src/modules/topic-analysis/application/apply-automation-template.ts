import { renderCard } from './render-report-html'
import { resolveTemplateComponent } from '../../workspace/report-template-catalog'
import { z } from 'zod'
import { load } from 'cheerio'
import { ReportSpecSchema, type ReportSpec } from '../domain/report-spec-schemas'
import { sanitizeReportFragment } from '../domain/sanitize-report-fragment'

const snapshotSchema = z.object({templateId: z.string().nullable().optional(), template: z.object({html: z.string().optional(),sections: z.array(z.object({id: z.string(),heading: z.string(),html: z.string(),enabled: z.boolean()}))}).nullable().optional()})

/** Resolve the frozen template against actual report content before persisting it. */
export function applyAutomationTemplate(spec: ReportSpec, snapshot: unknown): ReportSpec {
  const parsed = snapshotSchema.safeParse(snapshot)
  if (!parsed.success || !parsed.data.template || spec.card === 'K6') return spec
  const config = spec.customization ?? {headings: {},order: [],sections: [],sources: [],templateId: null,customHtml: null}
  const escape = (text: string) => {const $ = load('<span></span>',{},false); $('span').text(text); return $('span').html() ?? ''}
  const paragraph = (value: string) => `<p>${escape(value)}</p>`
  const table = spec.card === 'K2' ? load(renderCard(spec),{},false)('.table-section').toString() : ''
  const content: Record<string,string> = {
    summary: paragraph(spec.summary),
    changes: paragraph(spec.title) + (spec.card === 'K3' ? paragraph(`${spec.oldDeadline} → ${spec.newDeadline}`) : spec.card === 'K4' ? paragraph(spec.removedRule) + (spec.replacementRule ? paragraph(spec.replacementRule) : '') : '') + table,
    impact: (spec.affectedParties.length ? `<ul>${spec.affectedParties.map(item => `<li>${escape(item)}</li>`).join('')}</ul>` : '') + (spec.note ? paragraph(spec.note) : ''),
    sources: `<ul>${[{label:spec.source.label,url:spec.source.url},...config.sources].filter((item,index,list)=>list.findIndex(other=>other.url===item.url)===index).map(item => `<li>${item.url ? `<a href="${escape(item.url)}">${escape(item.label)}</a>` : escape(item.label)}</li>`).join('')}</ul>`,
  }
  const sections = parsed.data.template.sections.filter(section => section.enabled).map(section => {
    const resolved = (section.html.includes('data-template-content') || /^sources(?:-|$)/.test(section.id) && section.html.includes('class="source"')) ? resolveTemplateComponent(section,spec) : null
    if (resolved !== null) return sanitizeReportFragment(resolved)
    return sanitizeReportFragment(section.html.replaceAll('{{heading}}',escape(config.headings[section.id] ?? section.heading)).replaceAll('{{content}}', content[section.id.split('-')[0] ?? ''] ?? paragraph(spec.summary)).replace(/\{\{[^}]+\}\}/g,''))
  })
  // Preserve evidenced tables and dates even in a template without a changes section.
  if (table && !parsed.data.template.sections.some(section=>section.enabled && ['changes','table','K2'].includes(section.id.split('-')[0] ?? ''))) sections.push(table)
  if (spec.dates.length && !parsed.data.template.sections.some(section=>section.enabled && (section.id==='dates' || /^K[1-5]/.test(section.id)))) sections.push(load(renderCard(spec),{},false)('.block:has([data-field^="dates."])').toString())
  let html = parsed.data.template.html ?? '{{sections}}'
  html = html.replaceAll('{{title}}',escape(spec.title)).replaceAll('{{date}}',escape(spec.displayDate)).replaceAll('{{sections}}',sections.join('\n')).replace(/\{\{[^}]+\}\}/g,'')
  if (/<!doctype|<html|<body/i.test(html)) {const $ = load(html); html = $('.feed').length ? $('.feed').html() ?? '' : $('body').html() ?? ''}
  return ReportSpecSchema.parse({...spec,customization: {...config,sections: [],templateId: parsed.data.templateId ?? null,customHtml: sanitizeReportFragment(html)}})
}
