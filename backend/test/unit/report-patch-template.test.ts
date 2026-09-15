import { describe, expect, it } from 'vitest'
import { renderReportHtml } from '../../src/modules/topic-analysis/application/render-report-html'
import { validateReportHtml } from '../../src/modules/topic-analysis/application/validate-report-html'
import { matchEditablePattern } from '../../src/modules/topic-analysis/domain/report-patch'
import { ReportSpecSchema, type ReportSpec } from '../../src/modules/topic-analysis/domain/report-spec-schemas'

const topicId = '4f2a6c1e-1111-4222-8333-444455556666'

const common = {
  schemaVersion: 1,
  templateFamily: 'bulten-v2',
  reportId: '110926-01',
  topicId,
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
  blocks: ['B1', 'B10'],
}

const cards: Record<string, ReportSpec> = {
  K1: ReportSpecSchema.parse({ ...common, card: 'K1' }),
  K2: ReportSpecSchema.parse({
    ...common, card: 'K2',
    table: { title: 'Oran tablosu', columns: ['Madde', 'Eski', 'Yeni'], rows: [['Kahve', '10', '12'], ['Çay', '8', '9']], note: 'Tablo notu.' },
  }),
  K3: ReportSpecSchema.parse({
    ...common, card: 'K3', oldDeadline: '30 Haziran 2026', newDeadline: '31 Aralık 2026',
    timeline: [{ date: '11 Eylül 2026', description: 'Karar yayımlandı.' }],
  }),
  K4: ReportSpecSchema.parse({ ...common, card: 'K4', removedRule: 'Eski hüküm', replacementRule: 'Yeni hüküm', alert: 'Kritik uyarı metni.' }),
  K5: ReportSpecSchema.parse({ ...common, card: 'K5', supportingSource: { label: 'Bakanlık duyurusu', url: 'https://ticaret.gov.tr/duyuru' } }),
}

function renderedFields(html: string): string[] {
  return [...html.matchAll(/data-field="([^"]+)"/g)].map((match) => match[1] as string)
}

describe('template field markers', () => {
  it.each(Object.keys(cards))('marks %s fields with paths the patch catalogue accepts', async (card) => {
    const html = await renderReportHtml(cards[card] as ReportSpec)

    const fields = renderedFields(html)
    expect(fields.length).toBeGreaterThan(0)
    for (const path of fields) {
      // A marker the catalogue rejects would be an editable-looking field the API refuses.
      expect(matchEditablePattern(path), `${card}: ${path}`).not.toBeNull()
    }
  })

  it('offers every editable field of the card in the markup', async () => {
    const html = await renderReportHtml(cards.K2 as ReportSpec)
    const fields = new Set(renderedFields(html))

    for (const expected of [
      'title', 'typeLabel', 'summary', 'documentNumber', 'note',
      'affectedParties.0', 'affectedParties.1', 'dates.0',
      'table.title', 'table.note', 'table.rows.0.0', 'table.rows.1.2',
    ]) {
      expect(fields, expected).toContain(expected)
    }
  })

  it('marks the deadline and timeline fields of a K3 card', async () => {
    const fields = new Set(renderedFields(await renderReportHtml(cards.K3 as ReportSpec)))

    expect(fields).toContain('oldDeadline')
    expect(fields).toContain('newDeadline')
    expect(fields).toContain('timeline.0.date')
    expect(fields).toContain('timeline.0.description')
  })

  it('marks the removal fields of a K4 card', async () => {
    const fields = new Set(renderedFields(await renderReportHtml(cards.K4 as ReportSpec)))

    expect(fields).toContain('removedRule')
    expect(fields).toContain('replacementRule')
    expect(fields).toContain('alert')
  })

  it('never marks a locked field', async () => {
    for (const card of Object.keys(cards)) {
      const fields = new Set(renderedFields(await renderReportHtml(cards[card] as ReportSpec)))
      for (const locked of ['issueNumber', 'displayDate', 'documentTitle', 'reportId', 'card', 'topicId', 'source.url', 'blocks']) {
        expect(fields, `${card}: ${locked}`).not.toContain(locked)
      }
    }
  })

  it('keeps every card passing the publication contract with the markers in place', async () => {
    for (const [card, spec] of Object.entries(cards)) {
      const html = await renderReportHtml(spec)

      expect(() => validateReportHtml(html, { card: spec.card, topicId, basename: `01-${card.toLowerCase()}.html` })).not.toThrow()
    }
  })

  it('still rejects a document that smuggles in another data attribute', async () => {
    const html = (await renderReportHtml(cards.K1 as ReportSpec)).replace('<article class="card">', '<article class="card" data-track="x">')

    expect(() => validateReportHtml(html, { card: 'K1', topicId, basename: '01-k1.html' })).toThrow(/İzinsiz data özniteliği/)
  })

  it('still rejects a document carrying a script', async () => {
    const html = (await renderReportHtml(cards.K1 as ReportSpec)).replace('</body>', '<script>alert(1)</script></body>')

    expect(() => validateReportHtml(html, { card: 'K1', topicId, basename: '01-k1.html' })).toThrow(/Yasaklı HTML/)
  })
})
