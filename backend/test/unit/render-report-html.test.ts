import { describe, expect, it } from 'vitest'
import { renderReportHtml } from '../../src/modules/topic-analysis/application/render-report-html'
import type { ReportSpec } from '../../src/modules/topic-analysis/domain/report-spec-schemas'

const topicId = '11111111-1111-4111-8111-111111111111'
const spec: ReportSpec = {
  schemaVersion: 1, templateFamily: 'bulten-v2', reportId: '110926-01', topicId, card: 'K1',
  documentTitle: 'ATEZ Mevzuat Radarı Günlük Raporu — İthalat Tebliği', issueNumber: '33000', displayDate: '11 Eylül 2026, Cuma',
  typeLabel: 'Değişiklik', title: '<İthalat> & Tebliği', documentNumber: '2026/8', summary: 'Yeni oran uygulanır.',
  affectedParties: ['İthalatçılar'], dates: ['11 Eylül 2026: Yürürlük tarihi'], note: null,
  source: { label: 'T.C. Resmî Gazete', url: 'https://www.resmigazete.gov.tr/current' }, blocks: ['B1', 'B2', 'B3', 'B4', 'B10'],
}

describe('renderReportHtml', () => {
  it('embeds the approved PNG, escapes source text and emits one card', async () => {
    const html = await renderReportHtml(spec)
    expect(html).toMatch(/src="data:image\/png;base64,/)
    expect(html).toContain('&lt;İthalat&gt; &amp; Tebliği')
    expect((html.match(/<article class="card/g) ?? [])).toHaveLength(1)
  })
})
