import { ScanApiError } from '../scans/api'

export interface ReportTemplateSummary {
  id: string
  name: string
  description: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export interface ReportTemplate extends ReportTemplateSummary {
  html: string
}

export interface TemplateInput {
  name: string
  description: string | null
  html: string
}

export interface TemplateCatalog {
  baseHtml: string
  components: Array<{ key: string; name: string; description: string; html: string }>
  presets: Array<{ key: string; name: string; description: string; components: string[] }>
}

export function insertComponent(html: string, component: TemplateCatalog['components'][number]): string {
  const block = `<!-- ATEZ_COMPONENT:${component.key}:${crypto.randomUUID()} -->${component.html}<!-- /ATEZ_COMPONENT -->`
  if (html.includes('<!-- ATEZ_COMPONENTS -->')) return html.replace('<!-- ATEZ_COMPONENTS -->', `${block}\n<!-- ATEZ_COMPONENTS -->`)
  return /<\/main\s*>/i.test(html) ? html.replace(/<\/main\s*>/i, `${block}\n$&`) : /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, `${block}\n$&`) : `${html}\n${block}`
}

const componentPattern = /<!-- ATEZ_COMPONENT:([^:]+):([^ ]+) -->([\s\S]*?)<!-- \/ATEZ_COMPONENT -->/g

export function listPlacedComponents(html: string): Array<{ key: string; id: string }> {
  return [...html.matchAll(componentPattern)].map((match) => ({ key: match[1], id: match[2] }))
}

export function removePlacedComponent(html: string, id: string): string {
  return html.replace(componentPattern, (block, _key: string, blockId: string) => blockId === id ? '' : block)
}

export function movePlacedComponent(html: string, id: string, direction: -1 | 1): string {
  const blocks = [...html.matchAll(componentPattern)]
  const position = blocks.findIndex((match) => match[2] === id)
  const next = position + direction
  if (position < 0 || next < 0 || next >= blocks.length) return html
  const swapped = blocks.map((match) => match[0])
  ;[swapped[position], swapped[next]] = [swapped[next], swapped[position]]
  let index = 0
  return html.replace(componentPattern, () => swapped[index++])
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/report-templates${path}`, init)
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string }
    throw new ScanApiError(response.status, payload.message ?? 'Şablon işlemi tamamlanamadı')
  }
  return response.json() as Promise<T>
}

export async function listReportTemplates(): Promise<ReportTemplateSummary[]> {
  return (await request<{ templates: ReportTemplateSummary[] }>('/')).templates
}

export function getTemplateCatalog(): Promise<TemplateCatalog> { return request<TemplateCatalog>('/catalog') }

export function suggestReportTemplate(input: TemplateInput & { message: string }): Promise<TemplateInput & { summary: string }> {
  return request('/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
}

export function getReportTemplate(id: string): Promise<ReportTemplate> {
  return request<ReportTemplate>(`/${encodeURIComponent(id)}`)
}

export function createReportTemplate(input: TemplateInput): Promise<ReportTemplate> {
  return request<ReportTemplate>('/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}

export function updateReportTemplate(id: string, input: TemplateInput & { revision: number }): Promise<ReportTemplate> {
  return request<ReportTemplate>(`/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}
