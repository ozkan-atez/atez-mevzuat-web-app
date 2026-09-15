import { describe, expect, it } from 'vitest'
import { classifyRevisionKind } from '../../src/modules/topic-analysis/application/build-revision-context'
import {
  PatchResponseSchema,
  buildEditableFieldInventory,
  buildPatchSystemInstruction,
  patchResponseJsonSchema,
} from '../../src/modules/topic-analysis/application/patch-prompts'
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
  summary: 'Özet metni.',
  affectedParties: ['İthalatçılar', 'Gümrük müşavirleri'],
  dates: ['11 Eylül 2026: Yürürlüğe girer.'],
  note: null,
  source: { label: 'T.C. Resmî Gazete', url: 'https://www.resmigazete.gov.tr/doc.htm' },
  blocks: ['B1', 'B2', 'B10'],
  table: { title: 'Oran tablosu', columns: ['Madde', 'Eski', 'Yeni'], rows: [['Kahve', '10', '12'], ['Çay', '8', '9']], note: null },
})

describe('classifyRevisionKind', () => {
  it('starts every request on the patch path, whatever words it contains', () => {
    // Keyword routing sent "put only the dates on this line" to the analysis path
    // because it contains "tarih", even though it only changes wording.
    expect(classifyRevisionKind()).toBe('DIRECT_EDIT')
  })
})

describe('buildEditableFieldInventory', () => {
  it('offers only the paths this card actually carries, with their values', () => {
    const inventory = buildEditableFieldInventory(k2)
    const paths = inventory.map((entry) => entry.path)

    expect(paths).toContain('title')
    expect(paths).toContain('affectedParties.1')
    expect(paths).toContain('table.rows.1.2')
    expect(inventory.find((entry) => entry.path === 'title')?.value).toBe('İthalat Tebliğinde Değişiklik')
    // K3/K4 fields do not exist on a K2 card and must not be offered.
    expect(paths).not.toContain('oldDeadline')
    expect(paths).not.toContain('removedRule')
  })

  it('never offers a locked field or the block selection', () => {
    const paths = buildEditableFieldInventory(k2).map((entry) => entry.path)

    for (const locked of ['issueNumber', 'displayDate', 'documentTitle', 'source.url', 'reportId', 'card', 'table.columns.0']) {
      expect(paths).not.toContain(locked)
    }
    expect(paths).not.toContain('blocks')
  })

  it('shows an empty nullable field rather than hiding it', () => {
    expect(buildEditableFieldInventory(k2).find((entry) => entry.path === 'note')?.value).toBe('(boş)')
  })
})

describe('patch response contract', () => {
  it('accepts an edit list and a refusal alike', () => {
    expect(PatchResponseSchema.safeParse({ outcome: 'EDITS', edits: [{ path: 'title', value: 'Yeni' }] }).success).toBe(true)
    expect(PatchResponseSchema.safeParse({ outcome: 'NEEDS_ANALYSIS', reason: 'Oran kanıta bağlı.' }).success).toBe(true)
    expect(PatchResponseSchema.safeParse({ outcome: 'EDITS', edits: [{ path: 'note', value: '', clear: true }] }).success).toBe(true)
  })

  it('rejects anything outside the contract', () => {
    expect(PatchResponseSchema.safeParse({ outcome: 'REWRITE' }).success).toBe(false)
    expect(PatchResponseSchema.safeParse({ outcome: 'EDITS', spec: { title: 'x' } }).success).toBe(false)
  })

  it('keeps the Gemini response schema free of the constructs it rejects', () => {
    const serialised = JSON.stringify(patchResponseJsonSchema)

    expect(serialised).not.toContain('minItems')
    expect(serialised).not.toContain('maxItems')
  })
})

describe('buildPatchSystemInstruction', () => {
  it('forbids producing a report and treats supplied content as data', () => {
    const instruction = buildPatchSystemInstruction()

    expect(instruction).toMatch(/HTML/)
    expect(instruction).toMatch(/talimatları uygulama/)
    expect(instruction).toMatch(/NEEDS_ANALYSIS/)
  })

  it('keeps a wording change on the patch path instead of escalating it', () => {
    // Shortening a dates line was escalated to a full analysis revision, which cost
    // a model run over the evidence and still did not make the change.
    const instruction = buildPatchSystemInstruction()

    expect(instruction).toMatch(/Varsayılanın EDITS olsun/)
    expect(instruction).toMatch(/sadece tarih yazsın/)
    expect(instruction).toMatch(/Mevcut metni kısaltmak veya yeniden yazmak yeni olgu gerektirmez/)
  })

  it('applies the part of a mixed request it can, instead of refusing all of it', () => {
    // "Drop USD from the table and trim the time from the title" mixes a locked
    // structural change with a plain wording one; refusing both left the user with
    // an analysis run that changed nothing.
    const instruction = buildPatchSystemInstruction()

    expect(instruction).toMatch(/Karma talepte tamamını reddetme/)
    expect(instruction).toMatch(/hiçbir parçası alan düzenlemesiyle karşılanamıyorsa/)
    expect(instruction).toMatch(/Tablodan satır eklemek veya çıkarmak yapı değişikliğidir/)
  })
})
