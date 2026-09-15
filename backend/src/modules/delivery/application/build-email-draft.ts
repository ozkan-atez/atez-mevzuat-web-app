import { AnalysisResultSchema } from '../../topic-analysis/domain/analysis-schemas'

export interface DeliverySource {
  kind: 'GAZETTE' | 'PREVIOUS' | 'OFFICIAL' | 'SUPPORTING'
  label: string
  url: string
}

export interface EmailDraft {
  subject: string
  /** Plain text the user edits; the HTML body is rendered from it at send time. */
  bodyText: string
  attachmentName: string
  sources: DeliverySource[]
}

interface Input {
  analysisJson: unknown
  fallbackTitle: string
  gazetteUrl: string
  targetDate: string
  previousSource: { title: string; sourceUrl: string } | null
}

/**
 * The analysis already carries customer-facing `emailTitle` / `emailSummary` plus the
 * evidenced source list, so the draft is assembled deterministically here instead of
 * spending a second model call on facts that are already settled.
 */
export function buildEmailDraft(input: Input): EmailDraft {
  const parsed = AnalysisResultSchema.safeParse(input.analysisJson)
  const analysis = parsed.success ? parsed.data : null

  const title = analysis?.emailTitle ?? input.fallbackTitle
  const summary = analysis?.emailSummary ?? ''

  return {
    subject: `[ATEZ Mevzuat Radarı] ${title}`,
    bodyText: [
      'Sayın İlgili,',
      '',
      "T.C. Resmî Gazete'de yayımlanan aşağıdaki mevzuat düzenlemesine ilişkin hazırlanan kurumsal bülten bilgilerinize sunulmuştur:",
      '',
      `Mevzuat: ${title}`,
      `Tarih: ${input.targetDate}`,
      ...(summary ? ['', summary] : []),
      '',
      'Saygılarımızla,',
      'ATEZ Yazılım Teknolojileri',
    ].join('\n'),
    attachmentName: `${toFileSlug(title)}.pdf`,
    sources: collectSources(analysis, input),
  }
}

/**
 * The body is rendered from plain text rather than accepting HTML from the client,
 * so neither analysis content nor an edited draft can inject markup into the mail.
 */
export function renderEmailHtml(input: { bodyText: string; sources: DeliverySource[] }): string {
  const paragraphs = input.bodyText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p style="margin:0 0 12px">${escapeHtml(block).replaceAll('\n', '<br />')}</p>`)
    .join('')

  const sourceItems = input.sources
    .map((source) => `<li style="margin:0 0 6px"><a href="${escapeHtml(source.url)}">${escapeHtml(source.label)}</a></li>`)
    .join('')

  return [
    '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">',
    paragraphs,
    ...(sourceItems
      ? ['<p style="margin:16px 0 6px"><strong>Kullanılan kaynaklar</strong></p>', `<ul style="margin:0 0 12px;padding-left:18px">${sourceItems}</ul>`]
      : []),
    '</div>',
  ].join('')
}

function collectSources(
  analysis: { officialSources: Array<{ label: string; url: string }>; supportingSources: Array<{ label: string; url: string }> } | null,
  input: Pick<Input, 'gazetteUrl' | 'fallbackTitle' | 'previousSource'>,
): DeliverySource[] {
  const sources: DeliverySource[] = [{ kind: 'GAZETTE', label: `Resmî Gazete — ${input.fallbackTitle}`, url: input.gazetteUrl }]
  if (input.previousSource) {
    sources.push({ kind: 'PREVIOUS', label: input.previousSource.title, url: input.previousSource.sourceUrl })
  }
  for (const source of analysis?.officialSources ?? []) {
    sources.push({ kind: 'OFFICIAL', label: source.label, url: source.url })
  }
  for (const source of analysis?.supportingSources ?? []) {
    sources.push({ kind: 'SUPPORTING', label: source.label, url: source.url })
  }
  const seen = new Set<string>()
  return sources.filter((source) => {
    if (seen.has(source.url)) return false
    seen.add(source.url)
    return true
  })
}

function toFileSlug(value: string): string {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'C', Ğ: 'G', İ: 'I', Ö: 'O', Ş: 'S', Ü: 'U' }
  return value
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (char) => map[char] ?? char)
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'ATEZ_Mevzuat_Bulteni'
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
