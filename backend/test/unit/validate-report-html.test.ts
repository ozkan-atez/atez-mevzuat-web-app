import { describe, expect, it } from 'vitest'
import { renderReportHtml } from '../../src/modules/topic-analysis/application/render-report-html'
import { validateReportHtml } from '../../src/modules/topic-analysis/application/validate-report-html'
import type { ReportSpec } from '../../src/modules/topic-analysis/domain/report-spec-schemas'

const topicId = '11111111-1111-4111-8111-111111111111'
const spec: ReportSpec = {
  schemaVersion: 1, templateFamily: 'bulten-v2', reportId: '110926-01', topicId, card: 'K1',
  documentTitle: 'ATEZ Mevzuat Radarı Günlük Raporu — İthalat', issueNumber: '33000', displayDate: '11 Eylül 2026, Cuma',
  typeLabel: 'Değişiklik', title: 'İthalat Tebliği', summary: 'Yeni oran uygulanır.', affectedParties: [], dates: [], note: null,
  source: { label: 'T.C. Resmî Gazete', url: 'https://www.resmigazete.gov.tr/current' }, blocks: ['B1', 'B2', 'B3', 'B10'],
}

describe('validateReportHtml', () => {
  it('accepts a rendered report', async () => {
    const html = await renderReportHtml(spec)
    expect(() => validateReportHtml(html, { card: 'K1', topicId, basename: `01-${topicId}.html` })).not.toThrow()
  })

  it('rejects scripts, unresolved placeholders and external images', () => {
    expect(() => validateReportHtml('<script>alert(1)</script>{{TITLE}}<img src="https://x">', { card: 'K1', topicId, basename: `01-${topicId}.html` })).toThrow()
  })
})
