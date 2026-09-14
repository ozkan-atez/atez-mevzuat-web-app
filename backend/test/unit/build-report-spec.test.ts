import { describe, expect, it } from 'vitest'
import { buildReportSpec } from '../../src/modules/topic-analysis/application/build-report-spec'
import type { AnalysisResult } from '../../src/modules/topic-analysis/domain/analysis-schemas'

const topicId = '11111111-1111-4111-8111-111111111111'

function analysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    schemaVersion: 1,
    topicId,
    status: 'PASS',
    document: { title: 'İthalat Tebliği', documentNumber: '2026/8', gazetteDate: '2026-09-11', gazetteNumber: '33000', sourceUrl: 'https://www.resmigazete.gov.tr/current' },
    change: { type: 'AMENDMENT', detailedAnalysis: 'Düzenlemenin ayrıntıları.', summary: 'İthalat uygulaması değiştirildi.', currentRule: 'Yeni uygulama yürürlüktedir.', operationalImpact: 'İthalat beyannameleri yeni kurala göre hazırlanmalıdır.' },
    affectedParties: [{ name: 'İthalatçılar', impact: 'Beyan süreçleri değişir.', evidenceIds: ['e1'] }],
    effectiveDates: [{ date: '2026-09-11', description: 'Yürürlük tarihi', evidenceIds: ['e1'] }],
    comparisons: [], tables: [],
    officialSources: [{ id: 's1', label: 'T.C. Resmî Gazete', url: 'https://www.resmigazete.gov.tr/current', evidenceIds: ['e1'] }],
    supportingSources: [], evidence: [{ id: 'e1', objectKey: 'objects/current.html', locator: 'paragraph:1' }], unresolvedReferences: [],
    emailTitle: 'İthalat uygulaması değişikliği', emailSummary: 'İthalat uygulamasında yeni kural yürürlüğe girmiştir.',
    ...overrides,
  }
}

describe('buildReportSpec', () => {
  it.each([
    ['REPEAL', 'K4'],
    ['DEADLINE_EXTENSION', 'K3'],
    ['AMENDMENT_WITH_TABLE', 'K2'],
    ['ANNOUNCEMENT_ONLY', 'K5'],
    ['AMENDMENT', 'K1'],
  ] as const)('maps %s analysis to %s', (fixture, expected) => {
    let value = analysis()
    if (fixture === 'REPEAL') value = analysis({ change: { ...value.change, type: 'REPEAL', previousRule: 'Eski izin yürürlükteydi.', currentRule: undefined } })
    if (fixture === 'DEADLINE_EXTENSION') value = analysis({ change: { ...value.change, type: 'DEADLINE_EXTENSION' }, comparisons: [{ label: 'Son tarih', before: '2026-09-01', after: '2026-10-01', evidenceIds: ['e1'] }] })
    if (fixture === 'AMENDMENT_WITH_TABLE') value = analysis({ tables: [{ title: 'Oranlar', columns: ['GTİP', 'Oran'], rows: [['0101', '%10'], ['0102', '%20']], evidenceIds: ['e1'] }] })
    if (fixture === 'ANNOUNCEMENT_ONLY') value = analysis({ change: { ...value.change, type: 'ANNOUNCEMENT' }, supportingSources: [{ id: 's2', label: 'Kurum duyurusu', url: 'https://example.com/duyuru', evidenceIds: ['e1'] }] })
    expect(buildReportSpec(value, { sequence: 1 }).card).toBe(expected)
  })

  it('does not create a table when structured rows are absent', () => {
    const spec = buildReportSpec(analysis({ tables: [] }), { sequence: 1 })
    expect(spec.card).not.toBe('K2')
    expect(spec.blocks).not.toContain('B8')
  })

  it('uses GGAAYY report identity and Turkish display date', () => {
    const spec = buildReportSpec(analysis(), { sequence: 3 })
    expect(spec.reportId).toBe('110926-03')
    expect(spec.displayDate).toContain('11 Eylül 2026')
  })
})
