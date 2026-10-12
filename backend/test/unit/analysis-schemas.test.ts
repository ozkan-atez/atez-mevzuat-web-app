import { describe, expect, it } from 'vitest'
import { parseGeneratedAnalysis } from '../../src/modules/topic-analysis/application/execute-topic-analysis'
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

it('ignores malformed model provenance while still validating the analysis',()=>{
 const value=validAnalysis();const generated={...value,document:{...value.document,sourceOrigin:{}}}
 expect(parseGeneratedAnalysis(generated).document.sourceOrigin).toBeUndefined()
 expect(()=>parseGeneratedAnalysis({...generated,change:{}})).toThrow()
})
it('can reload a normalized supporting-source analysis without fabricated official sources',()=>{
 const value=validAnalysis();expect(AnalysisResultSchema.parse({...value,officialSources:[],supportingSources:value.officialSources}).officialSources).toEqual([])
 expect(()=>AnalysisResultSchema.parse({...value,officialSources:[],supportingSources:[]})).toThrow()
})

it('permits source-table empty markers but still rejects filler in narrative fields', () => {
 const table = {title:'Kaynak verileri', columns:['GTİP','Değer'], rows:[['3907','-'], ['3908','—'], ['3909','N/A'], ['3910','']], evidenceIds:['evidence-1']}
 expect(AnalysisResultSchema.parse(validAnalysis({tables:[table]})).tables[0]!.rows).toEqual(table.rows)
 expect(() => AnalysisResultSchema.parse(validAnalysis({change:{type:'AMENDMENT',detailedAnalysis:'—',summary:'Özet'}}))).toThrow(/Dolgu/)
 expect(() => AnalysisResultSchema.parse(validAnalysis({tables:[{...table, rows:[['3907',null]]}]}))).toThrow()
})
it('shortens an overlong email subject while preserving the complete source title', () => {
 const title = 'Mevzuat başlığı '.repeat(20)
 const parsed = parseGeneratedAnalysis(validAnalysis({emailTitle:title, document:{...validAnalysis().document,title}}))
 expect(parsed.emailTitle.length).toBeLessThanOrEqual(120)
 expect(parsed.emailTitle.endsWith('…')).toBe(true)
 expect(parsed.document.title).toBe(title.trim())
})
