import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReportSpecV1 } from '@atez/contracts'
import { sha256 } from '@atez/platform'
import { CARD_LABELS } from './cards'
import { formatDateTr, formatTr } from './numbers'

const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const STATUS_TR: Record<string, string> = { CHANGED: 'Değişti', UNCHANGED: 'Değişmedi', NEW: 'Yeni önlem', REMOVED: 'Kaldırıldı', NO_PRIOR: 'Önceki değer yok' }

export interface Template {
  ref: string
  html: string
}

export function loadTemplate(configDir: string, name = 'report.v1'): Template {
  const html = readFileSync(join(configDir, 'templates', `${name}.html`), 'utf8')
  return { ref: `${name}@${sha256(html).slice(0, 8)}`, html }
}

/**
 * spec → HTML. Tablo hücreleri doğrudan analizdeki (kodla hesaplanmış) değerlerden üretilir;
 * render sonrası her hücre analize karşı geri doğrulanır.
 */
export function renderReport(spec: ReportSpecV1, template: Template): { html: string; issues: string[] } {
  const f = spec.fields
  const issues: string[] = []
  const effective = spec.dates.effective.filter((e) => e.date || e.rule !== 'UNRESOLVED')
  const datesHtml = `
    <dl class="dates">
      <div><dt>Yayım tarihi</dt><dd>${esc(formatDateTr(spec.dates.publication))}</dd></div>
      ${effective.map((e) => `<div><dt>Yürürlük${e.scope ? ` (${esc(e.scope)})` : ''}</dt><dd>${e.date ? esc(formatDateTr(e.date)) : 'Belirsiz'}</dd></div>`).join('')}
      ${spec.priorState.comparisonDate ? `<div><dt>Önceki hal tarihi</dt><dd>${esc(formatDateTr(spec.priorState.comparisonDate))}</dd></div>` : ''}
    </dl>`
  let table = ''
  if (spec.comparison && spec.comparison.rows.length) {
    const rows = spec.comparison.rows
    const notes: string[] = []
    table = `
    <section class="table">
      <h2>Karşılaştırma</h2>
      <div class="scroll"><table>
        <thead><tr><th>GTİP</th><th>Eşya</th><th>Menşe</th><th>Birim</th><th class="n">Önceki değer</th><th class="n">Yeni değer</th><th class="n">Değişim</th><th>Durum</th></tr></thead>
        <tbody>
        ${rows
          .map((r) => {
            const unit = [r.currency, r.unit].filter(Boolean).join(' / ')
            const pct = r.changePct === null ? '—' : `${r.changePct.startsWith('-') ? '' : '+'}%${formatTr(r.changePct)}`
            if (r.previous?.note) notes.push(`${r.gtip}: ${r.previous.note}`)
            return `<tr class="s-${r.status.toLowerCase()}"><td class="mono">${esc(r.gtip)}</td><td>${esc(r.description)}</td><td>${esc(r.origin ?? 'Tüm ülkeler')}</td><td>${esc(unit)}</td><td class="n" title="${esc(r.previous?.source)}">${esc(formatTr(r.previous?.value ?? null))}</td><td class="n" title="${esc(r.current?.source)}">${esc(formatTr(r.current?.value ?? null))}</td><td class="n">${esc(pct)}</td><td>${esc(STATUS_TR[r.status])}</td></tr>`
          })
          .join('')}
        </tbody>
      </table></div>
      ${f.tableNote ? `<p class="note">${esc(f.tableNote)}</p>` : ''}
      ${notes.length ? `<ul class="note muted">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${spec.comparison.note ? `<p class="note muted">${esc(spec.comparison.note)}</p>` : ''}
    </section>`
    // Geri doğrulama: render edilen her sayı analizdeki değerin Türkçe gösterimi olmalı.
    for (const r of rows) {
      if (r.current?.value && !table.includes(esc(formatTr(r.current.value)))) issues.push(`Tabloda yeni değer eksik: ${r.gtip}`)
      if (r.previous?.value && !table.includes(esc(formatTr(r.previous.value)))) issues.push(`Tabloda önceki değer eksik: ${r.gtip}`)
    }
  }
  const prior =
    spec.priorState.status === 'SINGLE_SOURCE' || spec.priorState.status === 'AMBIGUOUS'
      ? `<p class="callout">${esc(spec.priorState.note ?? 'Önceki hal bulunamadı.')}</p>`
      : ''
  const sources = `<section class="sources"><h2>Kaynaklar</h2><ul>${spec.sources
    .map((s) => `<li>${s.url ? `<a href="${esc(s.url)}">${esc(s.title)}</a>` : esc(s.title)} <span class="muted">· ${esc(formatDateTr(s.publicationDate))} · ${esc(s.role)}</span></li>`)
    .join('')}</ul></section>`
  const body = `
    <header>
      <p class="card">${esc(CARD_LABELS[spec.card])}</p>
      <h1>${esc(f.headline)}</h1>
      <p class="lead">${esc(f.lead)}</p>
      ${datesHtml}
    </header>
    ${prior}
    <section><h2>Öne çıkanlar</h2><ul class="points">${f.keyPoints.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></section>
    ${table}
    <section><h2>Firmalara etkisi</h2><p>${esc(f.impact)}</p></section>
    ${sources}`
  const html = template.html
    .replace('{{title}}', esc(f.headline))
    .replace('{{body}}', body)
    .replace('{{meta}}', esc(`Rapor ${spec.reportId.slice(0, 8)} · r${String(spec.revision).padStart(2, '0')} · Gönderime hazır`))
  return { html, issues }
}
