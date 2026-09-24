import type { AnalysisResult } from '../domain/analysis-schemas'

export function renderAnalysisMarkdown(analysis: AnalysisResult): string {
  const sections: string[] = [
    '# Mevzuat analizi',
    section('Belge kimliği', [
      `- Başlık: ${escapeMarkdown(analysis.document.title)}`,
      ...(analysis.document.documentNumber ? [`- Belge numarası: ${escapeMarkdown(analysis.document.documentNumber)}`] : []),
      `- Resmî Gazete: ${analysis.document.gazetteDate} / ${escapeMarkdown(analysis.document.gazetteNumber)}`,
      `- Kaynak: ${analysis.document.sourceUrl}`,
      `- Topic: ${analysis.topicId}`,
    ]),
    section('Düzenlemenin kapsamı', [escapeMarkdown(analysis.change.summary)]),
    section('Ayrıntılı analiz', [escapeMarkdown(analysis.change.detailedAnalysis)]),
  ]

  if (analysis.change.previousRule || analysis.change.currentRule || analysis.comparisons.length > 0) {
    sections.push(section('Önceki ve yeni durum', [
      ...(analysis.change.previousRule ? [`- Önceki: ${escapeMarkdown(analysis.change.previousRule)}`] : []),
      ...(analysis.change.currentRule ? [`- Yeni: ${escapeMarkdown(analysis.change.currentRule)}`] : []),
      ...analysis.comparisons.map((item) => `- ${escapeMarkdown(item.label)}: ${escapeMarkdown(item.before)} → ${escapeMarkdown(item.after)} [${evidenceRefs(item.evidenceIds)}]`),
    ]))
  }
  if (analysis.affectedParties.length > 0) {
    sections.push(section('Etkilenen taraflar', analysis.affectedParties.map((item) => `- ${escapeMarkdown(item.name)}: ${escapeMarkdown(item.impact)} [${evidenceRefs(item.evidenceIds)}]`)))
  }
  if (analysis.change.operationalImpact) {
    sections.push(section('Operasyonel etkiler', [escapeMarkdown(analysis.change.operationalImpact)]))
  }
  if (analysis.effectiveDates.length > 0) {
    sections.push(section('Tarihler ve koşullar', analysis.effectiveDates.map((item) => `- ${item.date}: ${escapeMarkdown(item.description)} [${evidenceRefs(item.evidenceIds)}]`)))
  }
  if (analysis.tables.length > 0) {
    sections.push(section('Tablolar', analysis.tables.flatMap((table) => [
      `### ${escapeMarkdown(table.title)}`,
      `| ${table.columns.map(escapeMarkdown).join(' | ')} |`,
      `| ${table.columns.map(() => '---').join(' | ')} |`,
      ...table.rows.map((row) => `| ${row.map(escapeMarkdown).join(' | ')} |`),
      ...(table.note ? [escapeMarkdown(table.note)] : []),
      `[${evidenceRefs(table.evidenceIds)}]`,
    ])))
  }
  sections.push(section('Kaynaklar', [
    ...analysis.officialSources.map((source) => `- Resmî: [${escapeMarkdown(source.label)}](${source.url}) [${evidenceRefs(source.evidenceIds)}]`),
    ...analysis.supportingSources.map((source) => `- Destekleyici: [${escapeMarkdown(source.label)}](${source.url}) [${evidenceRefs(source.evidenceIds)}]`),
  ]))
  sections.push(section('Kanıt konumları', analysis.evidence.map((item) => `- evidence:${escapeMarkdown(item.id)} — ${escapeMarkdown(item.objectKey)}#${escapeMarkdown(item.locator)}`)))
  if (analysis.unresolvedReferences.length > 0) {
    sections.push(section('Çözülemeyen referanslar', analysis.unresolvedReferences.map((item) => `- ${escapeMarkdown(item.reference)}: ${escapeMarkdown(item.reason)}`)))
  }
  return `${sections.filter(Boolean).join('\n\n')}\n`
}

function section(title: string, lines: string[]): string {
  return lines.length > 0 ? `## ${title}\n\n${lines.join('\n')}` : ''
}

function evidenceRefs(ids: string[]): string {
  return ids.map((id) => `evidence:${escapeMarkdown(id)}`).join(', ')
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+|])/g, '\\$1')
}
