import { describe, expect, it } from 'vitest'
import { reportVisualDocument } from './ReportLayoutDesigner'

describe('reportVisualDocument', () => {
  it('uses the actual report shell and keeps the official source protected', () => {
    const view = { html: '<html><head><style>.card{color:purple}</style></head><body><header>ATEZ</header><article class="card"><div class="metadata">Rapor adı</div><section><h2>Gerçek özet</h2><p data-field="summary">Gerçek içerik</p></section><div class="source"><a href="https://resmigazete.gov.tr">Resmî kaynak</a></div></article></body></html>', spec: {}, draft: null, baseVersion: 1, publishedVersion: 1, isStale: false }
    const parsed = reportVisualDocument(view, {})
    expect(parsed.html).toContain('.card{color:purple}')
    expect(parsed.html).toContain('{{sections}}')
    expect(parsed.html).toContain('Resmî kaynak')
    expect(parsed.sections[1]).toMatchObject({ heading: 'Gerçek özet', html: '<section><h2>{{heading}}</h2><p>Gerçek içerik</p></section>' })
    expect(parsed.sections.map(s => s.html).join('')).not.toContain('Resmî kaynak')
  })
  it('edits the customized body without duplicating saved source references', () => {
    const view = { html: '<html><body><article class="card"><div data-field="customization.customHtml"><section><h2>Özel başlık</h2><p>Özel içerik</p></section></div><section><h2>Kaynakça</h2><ul><li>Ek kaynak</li></ul></section><div class="source">Resmî kaynak</div></article></body></html>', spec: {}, draft: null, baseVersion: 1, publishedVersion: 1, isStale: false }
    const parsed = reportVisualDocument(view, { sources: [{ id: 's', label: 'Ek kaynak', content: 'Kanıt', url: '', kind: 'TEXT' }] })
    expect(parsed.sections).toHaveLength(1)
    expect(parsed.sections[0]?.heading).toBe('Özel başlık')
    expect(parsed.html).toContain('Ek kaynak')
    expect(parsed.sections[0]?.html).not.toContain('data-field')
  })
})
