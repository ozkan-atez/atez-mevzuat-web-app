import { describe, expect, it } from 'vitest'
import { ReportSpecSchema } from '../../src/modules/topic-analysis/domain/report-spec-schemas'

const common = {
  schemaVersion: 1,
  templateFamily: 'bulten-v2',
  reportId: '110926-01',
  topicId: '11111111-1111-4111-8111-111111111111',
  documentTitle: 'İthalat Rejimi Değişikliği',
  issueNumber: '33000',
  displayDate: '11 Eylül 2026, Cuma',
  typeLabel: 'Değişiklik',
  title: 'İthalat Rejimi Kararında Değişiklik',
  summary: 'İthalat koşulları güncellenmiştir.',
  affectedParties: [],
  dates: [],
  note: null,
  source: { label: 'Resmî Gazete, 11 Eylül 2026 / 33000', url: 'https://www.resmigazete.gov.tr/eskiler/2026/09/20260911-1.pdf' },
  blocks: ['B1', 'B2', 'B3', 'B10'],
}

describe('ReportSpecSchema', () => {
  it('accepts a tablosuz K1 report', () => {
    expect(ReportSpecSchema.parse({ ...common, card: 'K1' }).card).toBe('K1')
  })

  it('requires at least two rows for a K2 report', () => {
    expect(() => ReportSpecSchema.parse({
      ...common,
      card: 'K2',
      table: { title: 'Oranlar', columns: ['GTİP', 'Oran'], rows: [['3907', '%10']], note: null },
    })).toThrow()
  })

  it('requires a null topic for the K6 no-change report', () => {
    const parsed = ReportSpecSchema.parse({
      schemaVersion: 1,
      templateFamily: 'bulten-v2',
      reportId: '110926-00',
      topicId: null,
      card: 'K6',
      documentTitle: 'ATEZ Mevzuat Radarı Günlük Raporu — Değişiklik Yok',
      issueNumber: '33000',
      displayDate: '11 Eylül 2026, Cuma',
      emptyDayText: 'İncelenen 12 resmî belgede raporlanabilir değişiklik bulunmadı.',
      source: common.source,
      blocks: ['B1', 'B10'],
    })
    expect(parsed.topicId).toBeNull()
  })
})
