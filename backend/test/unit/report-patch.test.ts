import { describe, expect, it } from 'vitest'
import {
  EDITABLE_PATH_PATTERNS,
  ReportPatchError,
  applyReportPatch,
  matchEditablePattern,
} from '../../src/modules/topic-analysis/domain/report-patch'
import { ReportSpecSchema, type ReportSpec } from '../../src/modules/topic-analysis/domain/report-spec-schemas'

const k2: ReportSpec = ReportSpecSchema.parse({
  schemaVersion: 1,
  templateFamily: 'bulten-v2',
  reportId: '110926-01',
  topicId: '4f2a6c1e-1111-4222-8333-444455556666',
  card: 'K2',
  documentTitle: 'İthalat Tebliği',
  issueNumber: '33367',
  displayDate: '11 Eylül 2026 Cuma',
  typeLabel: 'Değişiklik',
  title: 'İthalat Tebliğinde Değişiklik',
  documentNumber: '2026/8',
  summary: 'Özet metni.',
  affectedParties: ['İthalatçılar', 'Gümrük müşavirleri'],
  dates: ['11 Eylül 2026: Yürürlüğe girer.'],
  note: 'Dikkat edilmesi gereken not.',
  source: { label: 'T.C. Resmî Gazete', url: 'https://www.resmigazete.gov.tr/doc.htm' },
  blocks: ['B1', 'B2', 'B10'],
  table: {
    title: 'Oran tablosu',
    columns: ['Madde', 'Eski', 'Yeni'],
    rows: [['Kahve', '10', '12'], ['Çay', '8', '9']],
    note: null,
  },
})

describe('matchEditablePattern', () => {
  it('accepts indexed array paths and rejects out-of-catalogue ones', () => {
    expect(matchEditablePattern('affectedParties.1')).toBe('affectedParties.#')
    expect(matchEditablePattern('table.rows.0.2')).toBe('table.rows.#.#')
    expect(matchEditablePattern('table.rows.x.2')).toBeNull()
    expect(matchEditablePattern('summary')).toBe('summary')
  })

  it('does not treat the dot in a pattern as a wildcard', () => {
    expect(matchEditablePattern('tableXtitle')).toBeNull()
  })

  it('locks every identity and evidence field', () => {
    for (const locked of ['reportId', 'topicId', 'card', 'issueNumber', 'displayDate', 'documentTitle', 'source.url', 'table.columns']) {
      expect(EDITABLE_PATH_PATTERNS).not.toContain(locked)
      expect(matchEditablePattern(locked)).toBeNull()
    }
  })
})

describe('applyReportPatch', () => {
  it('changes only the named fields and leaves the rest byte for byte', () => {
    const { spec, applied } = applyReportPatch(k2, {
      edits: [{ path: 'title', value: 'Düzeltilmiş Başlık' }],
    })

    expect(spec.card === 'K2' && spec.title).toBe('Düzeltilmiş Başlık')
    expect(applied).toEqual([{ path: 'title', previousValue: 'İthalat Tebliğinde Değişiklik', nextValue: 'Düzeltilmiş Başlık' }])
    expect({ ...spec, title: k2.card === 'K2' ? k2.title : '' }).toEqual(k2)
  })

  it('does not mutate the spec it was given', () => {
    const before = structuredClone(k2)

    applyReportPatch(k2, { edits: [{ path: 'summary', value: 'Yeni özet.' }] })

    expect(k2).toEqual(before)
  })

  it('edits an array element and a table cell by index', () => {
    const { spec } = applyReportPatch(k2, {
      edits: [
        { path: 'affectedParties.1', value: 'Taşıyıcılar' },
        { path: 'table.rows.0.2', value: '15' },
      ],
    })

    expect(spec.card === 'K2' && spec.affectedParties).toEqual(['İthalatçılar', 'Taşıyıcılar'])
    expect(spec.card === 'K2' && spec.table.rows[0]).toEqual(['Kahve', '10', '15'])
  })

  it('clears a nullable field', () => {
    const { spec } = applyReportPatch(k2, { edits: [{ path: 'note', value: null }] })

    expect(spec.card === 'K2' && spec.note).toBeNull()
  })

  it('rejects a locked path and applies nothing at all', () => {
    const attempt = () => applyReportPatch(k2, {
      edits: [
        { path: 'summary', value: 'Bu uygulanmamalı.' },
        { path: 'issueNumber', value: '99999' },
      ],
    })

    expect(attempt).toThrow(ReportPatchError)
    try { attempt() } catch (error) {
      expect((error as ReportPatchError).reason).toBe('LOCKED_PATH')
      expect((error as ReportPatchError).path).toBe('issueNumber')
    }
    expect(k2.card === 'K2' && k2.summary).toBe('Özet metni.')
  })

  it('rejects an editable field that this card does not carry', () => {
    // `oldDeadline` is editable on a K3 deadline card but absent from a K2 table card.
    try {
      applyReportPatch(k2, { edits: [{ path: 'oldDeadline', value: '1 Ocak' }] })
      throw new Error('beklenen hata atılmadı')
    } catch (error) {
      expect((error as ReportPatchError).reason).toBe('MISSING_TARGET')
    }
  })

  it('separates a field that exists but is locked from one that does not exist', () => {
    const locked = () => applyReportPatch(k2, { edits: [{ path: 'source.url', value: 'https://baska.example' }] })
    const unknown = () => applyReportPatch(k2, { edits: [{ path: 'uydurmaAlan', value: 'x' }] })

    expect(locked).toThrow(/değiştirilemez/)
    expect(unknown).toThrow(/bulunmuyor/)
  })

  it('locks whole table rows so the column count cannot go ragged', () => {
    try {
      applyReportPatch(k2, { edits: [{ path: 'table.rows.0', value: ['Kahve', '10'] }] })
      throw new Error('beklenen hata atılmadı')
    } catch (error) {
      expect((error as ReportPatchError).reason).toBe('LOCKED_PATH')
    }
  })

  it('rejects an edit that would break the spec schema', () => {
    try {
      applyReportPatch(k2, { edits: [{ path: 'title', value: '' }] })
      throw new Error('beklenen hata atılmadı')
    } catch (error) {
      expect((error as ReportPatchError).reason).toBe('SCHEMA_VIOLATION')
    }
  })

  it('rejects an out-of-range array index instead of growing the spec', () => {
    try {
      applyReportPatch(k2, { edits: [{ path: 'affectedParties.7', value: 'Yeni taraf' }] })
      throw new Error('beklenen hata atılmadı')
    } catch (error) {
      expect((error as ReportPatchError).reason).toBe('MISSING_TARGET')
    }
  })

  it('reports no change when the value is identical', () => {
    const { applied } = applyReportPatch(k2, { edits: [{ path: 'summary', value: 'Özet metni.' }] })

    expect(applied).toEqual([])
  })
})
