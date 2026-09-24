import { describe, expect, it } from 'vitest'
import { renderAnalysisMarkdown } from '../../src/modules/topic-analysis/application/render-analysis-markdown'
import type { AnalysisResult } from '../../src/modules/topic-analysis/domain/analysis-schemas'

const analysis: AnalysisResult = {
  schemaVersion: 1,
  topicId: '11111111-1111-4111-8111-111111111111',
  status: 'PASS',
  document: { title: 'İthalat *Kararı*', gazetteDate: '2026-09-11', gazetteNumber: '33000', sourceUrl: 'https://www.resmigazete.gov.tr/current' },
  change: { type: 'AMENDMENT', detailedAnalysis: 'Yeni oran uygulanır.', summary: 'Oran değişmiştir.', currentRule: 'Yeni oran %10.', operationalImpact: 'Beyanname oranı güncellenir.' },
  affectedParties: [],
  effectiveDates: [],
  comparisons: [],
  tables: [],
  officialSources: [{ id: 'source-1', label: 'Resmî Gazete', url: 'https://www.resmigazete.gov.tr/current', evidenceIds: ['evidence-1'] }],
  supportingSources: [],
  evidence: [{ id: 'evidence-1', objectKey: 'objects/current.pdf', locator: 'page:1' }],
  unresolvedReferences: [],
  emailTitle: 'İthalat oranı değişikliği',
  emailSummary: 'Yeni oran uygulanacaktır.',
}

describe('renderAnalysisMarkdown', () => {
  it('omits empty sections and preserves evidence locators', () => {
    const markdown = renderAnalysisMarkdown(analysis)
    expect(markdown).toContain('## Belge kimliği')
    expect(markdown).toContain('İthalat \\*Kararı\\*')
    expect(markdown).not.toContain('## Tablolar')
    expect(markdown).toContain('evidence:evidence-1')
    expect(markdown).toContain('objects/current.pdf#page:1')
  })
})
