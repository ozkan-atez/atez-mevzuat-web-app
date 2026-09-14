import type { AnalysisResult } from '../domain/analysis-schemas'
import { ReportSpecSchema, type ReportSpec } from '../domain/report-spec-schemas'

export function buildReportSpec(analysis: AnalysisResult, options: { sequence: number }): ReportSpec {
  const sequence = String(options.sequence).padStart(2, '0')
  const common = {
    schemaVersion: 1 as const,
    templateFamily: 'bulten-v2' as const,
    reportId: `${compactDate(analysis.document.gazetteDate)}-${sequence}`,
    topicId: analysis.topicId,
    documentTitle: `ATEZ Mevzuat Radarı Günlük Raporu — ${analysis.document.title}`,
    issueNumber: analysis.document.gazetteNumber,
    displayDate: displayDate(analysis.document.gazetteDate),
    typeLabel: typeLabel(analysis.change.type),
    title: analysis.document.title,
    ...(analysis.document.documentNumber ? { documentNumber: analysis.document.documentNumber } : {}),
    summary: analysis.change.summary,
    affectedParties: analysis.affectedParties.slice(0, 3).map((item) => `${item.name}: ${item.impact}`),
    dates: analysis.effectiveDates.slice(0, 3).map((item) => `${displayDate(item.date, false)}: ${item.description}`),
    note: analysis.change.operationalImpact ?? null,
    source: { label: analysis.officialSources[0]?.label ?? 'T.C. Resmî Gazete', url: analysis.officialSources[0]?.url ?? analysis.document.sourceUrl },
  }

  if (analysis.status === 'PASS_NO_RELEVANT_CONTENT') {
    return ReportSpecSchema.parse({
      schemaVersion: 1,
      templateFamily: 'bulten-v2',
      reportId: `${compactDate(analysis.document.gazetteDate)}-00`,
      topicId: null,
      card: 'K6',
      documentTitle: 'ATEZ Mevzuat Radarı Günlük Raporu — Değişiklik Yok',
      issueNumber: analysis.document.gazetteNumber,
      displayDate: displayDate(analysis.document.gazetteDate),
      emptyDayText: analysis.change.summary.slice(0, 180),
      source: common.source,
      blocks: ['B1', 'B10'],
    })
  }

  if (analysis.change.type === 'REPEAL' || analysis.change.type === 'SUSPENSION') {
    return ReportSpecSchema.parse({
      ...common,
      card: 'K4',
      removedRule: analysis.change.previousRule ?? analysis.change.detailedAnalysis,
      replacementRule: analysis.change.currentRule ?? null,
      alert: analysis.change.operationalImpact ?? analysis.change.summary,
      blocks: blocks(['B1', 'B2', 'B3', analysis.change.previousRule && analysis.change.currentRule ? 'B6' : null, common.affectedParties.length ? 'B4' : null, common.dates.length > 1 ? 'B5' : common.dates.length ? 'B4' : null, 'B7', 'B10']),
    })
  }

  const deadline = analysis.change.type === 'DEADLINE_EXTENSION' ? analysis.comparisons[0] : undefined
  if (deadline) {
    return ReportSpecSchema.parse({
      ...common,
      card: 'K3',
      oldDeadline: deadline.before,
      newDeadline: deadline.after,
      timeline: analysis.effectiveDates.slice(0, 3).map((item) => ({ date: displayDate(item.date, false), description: item.description })),
      blocks: blocks(['B1', 'B2', 'B3', 'B6', common.affectedParties.length ? 'B4' : null, 'B5', common.note ? 'B7' : null, 'B10']),
    })
  }

  const table = analysis.tables.find((item) => item.rows.length >= 2)
  if (table) {
    return ReportSpecSchema.parse({
      ...common,
      card: 'K2',
      table: { title: table.title, columns: table.columns, rows: table.rows, note: table.note ?? null },
      blocks: blocks(['B1', 'B2', 'B3', common.affectedParties.length || common.dates.length ? 'B4' : null, common.note ? 'B7' : null, 'B8', 'B10']),
    })
  }

  if (analysis.change.type === 'ANNOUNCEMENT' && analysis.supportingSources[0]) {
    const supporting = analysis.supportingSources[0]
    return ReportSpecSchema.parse({
      ...common,
      card: 'K5',
      source: { label: supporting.label, url: supporting.url },
      supportingSource: { label: supporting.label, url: supporting.url },
      blocks: blocks(['B1', 'B2', 'B3', common.affectedParties.length || common.dates.length ? 'B4' : null, 'B9', 'B10']),
    })
  }

  return ReportSpecSchema.parse({
    ...common,
    card: 'K1',
    blocks: blocks(['B1', 'B2', 'B3', common.affectedParties.length || common.dates.length ? 'B4' : null, common.note ? 'B7' : null, 'B10']),
  })
}

function blocks(values: Array<'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7' | 'B8' | 'B9' | 'B10' | null>): Array<'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7' | 'B8' | 'B9' | 'B10'> {
  return [...new Set(values.filter((value): value is Exclude<typeof value, null> => value !== null))]
}

function compactDate(value: string): string {
  const [year, month, day] = value.split('-')
  return `${day}${month}${year?.slice(-2)}`
}

function displayDate(value: string, weekday = true): string {
  const date = new Date(`${value}T12:00:00.000Z`)
  const formatted = new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit', month: 'long', year: 'numeric', ...(weekday ? { weekday: 'long' as const } : {}), timeZone: 'Europe/Istanbul',
  }).format(date)
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

function typeLabel(type: AnalysisResult['change']['type']): string {
  return ({
    NEW_REGULATION: 'Yeni Tebliğ', AMENDMENT: 'Değişiklik', DEADLINE_EXTENSION: 'Süre Uzatımı', REPEAL: 'Yürürlükten Kaldırma',
    SUSPENSION: 'Askıya Alma', ANNOUNCEMENT: 'Duyuru', NO_CHANGE: 'Bilgi',
  } satisfies Record<AnalysisResult['change']['type'], string>)[type]
}
