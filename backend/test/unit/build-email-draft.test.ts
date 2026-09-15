import { describe, expect, it } from 'vitest'
import { buildEmailDraft, renderEmailHtml } from '../../src/modules/delivery/application/build-email-draft'

const analysis = {
  schemaVersion: 1,
  topicId: '4f2a6c1e-1111-4222-8333-444455556666',
  status: 'PASS',
  document: {
    title: 'İthalat Tebliği',
    gazetteDate: '2026-09-11',
    gazetteNumber: '33367',
    sourceUrl: 'https://www.resmigazete.gov.tr/eskiler/2026/09/20260911-5.htm',
  },
  change: {
    type: 'AMENDMENT',
    detailedAnalysis: 'Ayrıntılı analiz metni.',
    summary: 'Kısa özet.',
    operationalImpact: 'Operasyonel etki.',
  },
  affectedParties: [],
  effectiveDates: [],
  comparisons: [],
  tables: [],
  officialSources: [{ id: 's1', label: 'Tebliğ metni', url: 'https://www.resmigazete.gov.tr/eskiler/2026/09/20260911-5.htm', evidenceIds: ['e1'] }],
  supportingSources: [{ id: 's2', label: 'Ticaret Bakanlığı duyurusu', url: 'https://ticaret.gov.tr/duyuru', evidenceIds: ['e1'] }],
  evidence: [{ id: 'e1', objectKey: 'runs/doc.htm', locator: 'p.3' }],
  unresolvedReferences: [],
  emailTitle: 'İthalat Tebliğinde Değişiklik',
  emailSummary: 'Birinci paragraf.\n\nİkinci paragraf.',
}

const input = {
  fallbackTitle: 'İthalat Tebliği',
  gazetteUrl: 'https://www.resmigazete.gov.tr/eskiler/2026/09/20260911-5.htm',
  targetDate: '2026-09-11',
  previousSource: null,
}

describe('buildEmailDraft', () => {
  it('uses the analysis email fields and de-duplicates the gazette source', () => {
    const draft = buildEmailDraft({ ...input, analysisJson: analysis })

    expect(draft.subject).toBe('[ATEZ Mevzuat Radarı] İthalat Tebliğinde Değişiklik')
    expect(draft.attachmentName).toBe('Ithalat_Tebliginde_Degisiklik.pdf')
    expect(draft.sources.map((source) => source.url)).toEqual([
      'https://www.resmigazete.gov.tr/eskiler/2026/09/20260911-5.htm',
      'https://ticaret.gov.tr/duyuru',
    ])
    expect(draft.bodyText).toContain('Birinci paragraf.')
    expect(draft.bodyText).toContain('İkinci paragraf.')
    expect(draft.bodyText).toContain('Mevzuat: İthalat Tebliğinde Değişiklik')
  })

  it('escapes the edited body so no draft can inject markup into the mail', () => {
    const draft = buildEmailDraft({ ...input, analysisJson: analysis })
    const html = renderEmailHtml({ bodyText: '<script>alert(1)</script> devam', sources: draft.sources })

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('https://ticaret.gov.tr/duyuru')
  })

  it('falls back to the document title when the analysis is unusable', () => {
    const draft = buildEmailDraft({ ...input, analysisJson: { broken: true } })

    expect(draft.subject).toBe('[ATEZ Mevzuat Radarı] İthalat Tebliği')
    expect(draft.sources).toEqual([
      { kind: 'GAZETTE', label: 'Resmî Gazete — İthalat Tebliği', url: input.gazetteUrl },
    ])
  })

  it('lists the verified previous regulation right after the gazette source', () => {
    const draft = buildEmailDraft({
      ...input,
      analysisJson: analysis,
      previousSource: { title: 'İthalat Tebliği (No: 2025/1)', sourceUrl: 'https://www.resmigazete.gov.tr/eskiler/2025/01/20250104-3.htm' },
    })

    expect(draft.sources).toEqual([
      { kind: 'GAZETTE', label: 'Resmî Gazete — İthalat Tebliği', url: input.gazetteUrl },
      { kind: 'PREVIOUS', label: 'İthalat Tebliği (No: 2025/1)', url: 'https://www.resmigazete.gov.tr/eskiler/2025/01/20250104-3.htm' },
      { kind: 'SUPPORTING', label: 'Ticaret Bakanlığı duyurusu', url: 'https://ticaret.gov.tr/duyuru' },
    ])
  })
})
