import { describe, expect, it } from 'vitest'
import { AnalysisResultSchema } from '../../src/modules/topic-analysis/domain/analysis-schemas'

function validAnalysis(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    topicId: '11111111-1111-4111-8111-111111111111',
    status: 'PASS',
    document: {
      title: 'İthalat Rejimi Kararında Değişiklik Yapılmasına İlişkin Karar',
      documentNumber: '2026/8',
      gazetteDate: '2026-09-11',
      gazetteNumber: '33000',
      sourceUrl: 'https://www.resmigazete.gov.tr/eskiler/2026/09/20260911-1.pdf',
    },
    change: {
      type: 'AMENDMENT',
      detailedAnalysis: 'Düzenleme ithalat koşullarını değiştirmektedir.',
      summary: 'İthalat koşulları güncellenmiştir.',
      currentRule: 'Yeni oran uygulanır.',
      operationalImpact: 'İthalat beyannamelerinde yeni oran dikkate alınır.',
    },
    affectedParties: [],
    effectiveDates: [],
    comparisons: [],
    tables: [],
    officialSources: [{ id: 'source-1', label: 'Resmî Gazete', url: 'https://www.resmigazete.gov.tr/eskiler/2026/09/20260911-1.pdf', evidenceIds: ['evidence-1'] }],
    supportingSources: [],
    evidence: [{ id: 'evidence-1', objectKey: 'objects/abc.pdf', locator: 'page:1' }],
    unresolvedReferences: [],
    emailTitle: 'İthalat koşulları güncellendi',
    emailSummary: '11 Eylül 2026 tarihli düzenleme yeni ithalat koşullarını yürürlüğe koymuştur.',
    ...overrides,
  }
}

describe('AnalysisResultSchema', () => {
  it('accepts one topic without a table', () => {
    const parsed = AnalysisResultSchema.parse(validAnalysis())
    expect(parsed.tables).toEqual([])
    expect(parsed.topicId).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('rejects a response that attempts to split the topic', () => {
    expect(() => AnalysisResultSchema.parse({ ...validAnalysis(), topics: [validAnalysis()] })).toThrow()
  })

  it('rejects a table whose row width does not match its columns', () => {
    expect(() => AnalysisResultSchema.parse(validAnalysis({
      tables: [{ title: 'Oranlar', columns: ['GTİP', 'Oran'], rows: [['3907']], evidenceIds: ['evidence-1'] }],
    }))).toThrow(/sütun/i)
  })
})
