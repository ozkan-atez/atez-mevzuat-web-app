import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { ProfileModelOutput } from '@atez/contracts'
import { checkQuotes, cleanWordHtml, comparisonDate, decodeHtml, extractHints, finalizeProfile, mergeSegments, pdfPageCount, splitPdf, visibleText } from '../src/index'

const fx = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/rg/${name}`, import.meta.url)))

export function sampleModelProfile(over: Partial<ProfileModelOutput> = {}): ProfileModelOutput {
  return {
    decision: 'IN',
    coverage: { expected: { files: 1, pages: 2, tables: 0 }, read: { files: 1, pages: 2, tables: 0 }, complete: true },
    basisQuotes: [],
    relevance: { score: 0.9, categories: ['ithalat'] },
    rationale: 'Madde 1: ithalat.',
    identity: { docType: 'TEBLIG', title: 'T', institution: 'Ticaret Bakanlığı', officialNumber: '2025/43' },
    summary: 'Özet.',
    change: {
      kind: 'AMENDMENT',
      effectiveRules: [
        { rule: 'ON_PUBLICATION', explicitDate: null, days: null, scope: null, evidencePage: 2 },
        { rule: 'DAYS_AFTER_PUBLICATION', explicitDate: null, days: 30, scope: 'Madde 3', evidencePage: null },
        { rule: 'UNRESOLVED', explicitDate: null, days: null, scope: 'Madde 4', evidencePage: null },
      ],
    },
    gtip: { present: true, codes: [{ code: '7208.51', level: '6', context: 'x', page: 1 }], tables: [{ title: 'EK-1', pages: [2], approxRows: 10, columns: ['GTİP'] }] },
    references: [],
    lineage: { needsPrior: true, strategyHint: 'TARIFF', rgQueries: [], tariffQueries: [{ code: '7208.51', field: 'DAMPING' }, { code: '7208.51.20.00.11', field: 'DAMPING' }] },
    affected: { parties: [], sectors: ['çelik'] },
    keyPages: [1, 2],
    keywords: ['damping'],
    confidence: 0.8,
    ...over,
  }
}

const ctx = {
  documentVersionId: '00000000-0000-4000-8000-000000000001',
  contentHash: 'sha256:x',
  publication: { date: '2025-12-31', rgIssue: '33124', mukerrer: null },
  expected: { files: 1, pages: 2 },
  skipped: [],
  quoteCheck: { status: 'NOT_CHECKED' as const, checked: 0, missing: [], repairRounds: 0 },
  parts: [],
  generatedBy: { model: 'gemini-3.8-flash', promptVersion: 'p', aiCallIds: [] },
}

describe('Belge Profili son işleme (§6.2, §7.1)', () => {
  it('yürürlük tarihlerini ve TARIFF asOf = yayım − 1 değerini kod hesaplar', () => {
    const p = finalizeProfile(sampleModelProfile(), ctx)
    expect(p.change.effectiveRules.map((r) => r.resolvedDate)).toEqual(['2025-12-31', '2026-01-30', null])
    expect(p.lineage.comparisonPolicy).toBe('PUBLICATION_PREVIOUS_DAY')
    expect(p.lineage.tariffQueries).toEqual([
      { code: '7208.51', field: 'DAMPING', asOf: '2025-12-30', needsCodeExpansion: true },
      { code: '7208.51.20.00.11', field: 'DAMPING', asOf: '2025-12-30', needsCodeExpansion: false },
    ])
    expect(comparisonDate('2026-03-01')).toBe('2026-02-28')
    expect(p.decision).toBe('IN')
  })

  it('eksik kapsam veya okunamayan dosya → REVIEW (OUT asla)', () => {
    const out = finalizeProfile(sampleModelProfile({ decision: 'OUT' }), { ...ctx, skipped: [{ label: 'f2', reason: 'NEEDS_GOTENBERG' }] })
    expect(out.decision).toBe('REVIEW')
    expect(out.coverage.complete).toBe(false)
    expect(out.decisionAdjustments[0]).toMatchObject({ from: 'OUT', to: 'REVIEW' })
    const inc = finalizeProfile(sampleModelProfile({ coverage: { expected: { files: 1, pages: 2, tables: 0 }, read: { files: 1, pages: 1, tables: 0 }, complete: false } }), ctx)
    expect(inc.decision).toBe('REVIEW')
  })

  it('doğrulanamayan alıntı → REVIEW', () => {
    const p = finalizeProfile(sampleModelProfile(), { ...ctx, quoteCheck: { status: 'FAILED', checked: 1, missing: ['x'], repairRounds: 1 } })
    expect(p.decision).toBe('REVIEW')
  })

  it('parça birleştirme: IN baskın, kodlar tekil, sayfalar korunur', () => {
    const m = mergeSegments([
      { label: 'f1#p1', profile: sampleModelProfile({ decision: 'OUT', keyPages: [3] }) },
      { label: 'f1#p2', profile: sampleModelProfile({ decision: 'IN', keyPages: [260] }) },
    ])
    expect(m.decision).toBe('IN')
    expect(m.gtip.codes).toHaveLength(1)
    expect(m.keyPages).toEqual([3, 260])
    expect(m.rationale).toContain('[f1#p2]')
  })
})

describe('HTML normalizasyonu ve alıntı doğrulama', () => {
  const { html, encoding } = decodeHtml(fx('doc-20251231-9.htm'), 'text/html')
  it('windows-1254 Word çıktısını UTF-8 temiz HTML yapar', () => {
    expect(encoding).toBe('windows-1254')
    const cleaned = cleanWordHtml(html)
    expect(cleaned).toContain('İTHALATTA HAKSIZ REKABETİN ÖNLENMESİNE')
    expect(cleaned).not.toMatch(/mso-|<o:p|<style/i)
    expect(cleaned.length).toBeLessThan(html.length)
  })
  it('alıntıyı birebir (boşluk/küçük-büyük harf normalize) bulur, uydurmayı yakalar', () => {
    const text = visibleText(cleanWordHtml(html))
    const r = checkQuotes(
      [
        { quote: 'İthalatta  Haksız Rekabetin Önlenmesine', file: 'f1', page: null },
        { quote: 'bu cümle belgede yok', file: 'f1', page: null },
        { quote: 'pdf alıntısı', file: 'f2', page: 1 },
      ],
      [{ label: 'f1', text }, { label: 'f2', text: null }],
    )
    expect(r).toEqual({ checked: 2, missing: ['bu cümle belgede yok'] })
  })
  it('deterministik ipuçları: resmî numara ve GTİP adayları', () => {
    const h = extractHints(visibleText(html), 'İthalatta Haksız Rekabetin Önlenmesine İlişkin Tebliğ (No: 2025/43)')
    expect(h.officialNumbers).toContain('No: 2025/43')
    expect(h.gtipCandidates.length).toBeGreaterThan(0)
  })
})

describe('PDF bölme (§6.3)', () => {
  it('bayt ve sayfa sınırına göre parçalara böler', async () => {
    const doc = await PDFDocument.create()
    for (let i = 0; i < 40; i++) doc.addPage([600, 800]).drawText(`Sayfa ${i + 1} ${'x'.repeat(400)}`, { x: 10, y: 700, size: 6 })
    const bytes = await doc.save()
    const parts = await splitPdf(bytes, { maxBytes: Math.floor(bytes.length / 3), maxPages: 15 })
    expect(parts.length).toBeGreaterThanOrEqual(3)
    expect(parts[0]!.pageRange[0]).toBe(1)
    expect(parts.at(-1)!.pageRange[1]).toBe(40)
    for (const p of parts) {
      expect(p.pageRange[1] - p.pageRange[0] + 1).toBeLessThanOrEqual(15)
      expect(await pdfPageCount(p.bytes)).toBe(p.pageRange[1] - p.pageRange[0] + 1)
    }
  })
})
