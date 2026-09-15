import { readFile } from 'node:fs/promises'
import type { ReportSpec } from '../domain/report-spec-schemas'
import { renderPageSkeleton } from '../templates/bulten-v2'

let logoDataUri: string | undefined

export async function renderReportHtml(spec: ReportSpec): Promise<string> {
  const cardHtml = renderCard(spec)
  return renderPageSkeleton({
    topicId: spec.topicId ?? 'degisiklik-yok',
    documentTitle: escapeHtml(spec.documentTitle),
    reportId: escapeHtml(spec.reportId),
    issueNumber: escapeHtml(spec.issueNumber),
    displayDate: escapeHtml(spec.displayDate),
    cardHtml,
    logoDataUri: await loadLogo(),
  })
}

async function loadLogo(): Promise<string> {
  if (logoDataUri) return logoDataUri
  const bytes = await readFile(new URL('../assets/atez-logo.png', import.meta.url))
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('ATEZ logo dosyası geçerli PNG değil.')
  logoDataUri = `data:image/png;base64,${bytes.toString('base64')}`
  return logoDataUri
}

/**
 * Marks a node as the editable counterpart of a spec path. The inline editor finds
 * fields by these attributes, so every path the patch catalogue allows must appear
 * here — `report-patch-template.test.ts` holds the two in step.
 */
function field(path: string): string {
  return ` data-field="${path}"`
}

function renderCard(spec: ReportSpec): string {
  if (spec.card === 'K6') return `<article class="card empty-state">
  <div class="badge badge--info">Tür: Bilgi</div>
  <div class="empty-title"><h2>Kapsam içi değişiklik yok</h2><span class="info-mark" aria-label="Bilgi">i</span></div>
  <p>${escapeHtml(spec.displayDate)} tarihli kaynak seti incelendi; raporlanabilir konu bulunamadı.</p>
  <div class="info-box"><h3>Bilgi</h3><p${field('emptyDayText')}>${escapeHtml(spec.emptyDayText)}</p></div>
  ${sourceRow(spec.source)}
</article>`

  const pieces = [
    badge(spec),
    metadata(spec),
    '<div class="rule"></div>',
    textBlock(spec.card === 'K5' ? 'Duyuru kısa özeti' : 'Tebliğ kısa özeti', spec.summary, 'summary'),
  ]
  if (spec.card === 'K3') pieces.push(compareBlock('Değişen süre', 'Önceki son tarih', spec.oldDeadline, 'oldDeadline', 'Yeni son tarih', spec.newDeadline, 'newDeadline'))
  if (spec.card === 'K4' && spec.replacementRule) pieces.push(compareBlock('Kaldırılan ve yerine gelen düzenleme', 'Yürürlükten kaldırılan', spec.removedRule, 'removedRule', 'Yerine uygulanacak', spec.replacementRule, 'replacementRule'))
  if (spec.affectedParties.length) pieces.push(listBlock('Kimleri etkiliyor?', spec.affectedParties, 'affectedParties'))
  if (spec.card === 'K3') pieces.push(timelineBlock(spec.timeline))
  else if (spec.dates.length) pieces.push(listBlock(spec.card === 'K5' ? 'Duyuruya dair dikkat edilecek tarihler' : 'Tebliğe dair dikkat edilecek tarihler', spec.dates, 'dates'))
  if (spec.card === 'K4') pieces.push('<div class="rule"></div>', noteBlock('Kritik uyarı', spec.alert, true, 'alert'))
  else if (spec.note) pieces.push('<div class="rule"></div>', noteBlock('Tebliğe dair not', spec.note, false, 'note'))
  if (spec.card === 'K2') pieces.push(tableBlock(spec.table))
  if (spec.card === 'K5') pieces.push(`<div class="source-class"><div class="source-class-head"><span class="chip chip--supporting">Destekleyici</span><span class="source-label"${field('supportingSource.label')}>${escapeHtml(spec.supportingSource.label)}</span></div><p>Resmî kaynak değildir; bağlam için verilmiştir. Bağlayıcı hüküm için Resmî Gazete esas alınır.</p></div>`)
  pieces.push(sourceRow(spec.source))
  return `<article class="card">\n  ${pieces.join('\n  ')}\n</article>`
}

function badge(spec: Exclude<ReportSpec, { card: 'K6' }>): string {
  const className = spec.card === 'K4' ? 'badge badge--alert' : spec.card === 'K5' ? 'badge badge--info' : 'badge'
  return `<div class="${className}">Tür: <span${field('typeLabel')}>${escapeHtml(spec.typeLabel)}</span></div>`
}

function metadata(spec: Exclude<ReportSpec, { card: 'K6' }>): string {
  const number = spec.documentNumber ? `<br>(<span${field('documentNumber')}>${escapeHtml(spec.documentNumber)}</span>)` : ''
  const label = spec.card === 'K5' ? 'Duyuru başlığı' : 'Tebliğ başlığı'
  return `<div class="metadata"><div class="label">${label}</div><div class="title-value"><span${field('title')}>${escapeHtml(spec.title)}</span>${number}</div></div>`
}

function textBlock(heading: string, text: string, path: string): string { return `<section class="block"><h2>${heading}</h2><p${field(path)}>${escapeHtml(text)}</p></section>` }
function listBlock(heading: string, items: string[], path: string): string { return `<section class="block"><h2>${heading}</h2><ul>${items.slice(0, 3).map((item, index) => `<li${field(`${path}.${index}`)}>${escapeHtml(item)}</li>`).join('')}</ul></section>` }
function noteBlock(heading: string, text: string, alert: boolean, path: string): string { return `<aside class="note${alert ? ' note--alert' : ''}"><h2>${heading}</h2><p${field(path)}>${escapeHtml(text)}</p></aside>` }
function compareBlock(heading: string, oldLabel: string, oldText: string, oldPath: string, newLabel: string, newText: string, newPath: string): string { return `<section class="block"><h2>${heading}</h2><div class="compare"><div class="compare-cell"><h3>${oldLabel}</h3><p${field(oldPath)}>${escapeHtml(oldText)}</p></div><div class="compare-cell is-new"><h3>${newLabel}</h3><p${field(newPath)}>${escapeHtml(newText)}</p></div></div></section>` }
function timelineBlock(items: Array<{ date: string; description: string }>): string { return `<section class="block"><h2>Tebliğe dair dikkat edilecek tarihler</h2><div class="timeline">${items.slice(0, 3).map((item, index) => `<div class="timeline-row"><span class="timeline-date"${field(`timeline.${index}.date`)}>${escapeHtml(item.date)}</span><span class="timeline-text"${field(`timeline.${index}.description`)}>${escapeHtml(item.description)}</span></div>`).join('')}</div></section>` }
function tableBlock(table: Extract<ReportSpec, { card: 'K2' }>['table']): string {
  const wide = table.columns.length >= 5 ? ' data-table--wide' : ''
  const note = table.note ? `<ul class="table-notes"><li${field('table.note')}>${escapeHtml(table.note)}</li></ul>` : ''
  return `<section class="table-section"><h2${field('table.title')}>${escapeHtml(table.title)}</h2><div class="table-scroll"><table class="data-table${wide}"><thead><tr>${table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${table.rows.map((row, rowIndex) => `<tr>${row.map((cell, cellIndex) => `<td${field(`table.rows.${rowIndex}.${cellIndex}`)}>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${note}</section>`
}
function sourceRow(source: { label: string; url: string }): string { return `<div class="source"><span class="source-label">Kaynak:</span><a href="${escapeAttribute(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.label)} <svg class="external" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><path d="M4.6 1.6h5.8v5.8"></path><path d="M10.4 1.6 5.1 6.9"></path><path d="M8.6 8.4v2H1.6V3.4h2"></path></svg></a></div>` }

function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;') }
function escapeAttribute(value: string): string { return escapeHtml(value) }
