import { describe, expect, it } from 'vitest'
import { normalizeDocumentContent } from '../../src/modules/scan-runs/application/normalize-document-content'

describe('normalizeDocumentContent', () => {
  it('keeps meaningful HTML structure and removes executable or navigation noise', () => {
    const parts = normalizeDocumentContent({
      id: 'doc-1', title: 'Karar', mediaType: 'text/html',
      bytes: Buffer.from('<html><body><nav>Menü</nav><h1>İthalat Kararı</h1><p>Yeni tarife uygulanır.</p><table><tr><td>GTİP 123</td></tr></table><script>secret()</script></body></html>'),
    })
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ text: expect.stringContaining('İthalat Kararı') })
    expect(parts[0]).toMatchObject({ text: expect.stringContaining('GTİP 123') })
    expect(JSON.stringify(parts)).not.toContain('secret()')
    expect(JSON.stringify(parts)).not.toContain('Menü')
  })

  it('sends PDF bytes as Gemini inline data', () => {
    expect(normalizeDocumentContent({ id: 'doc-2', title: 'PDF Karar', mediaType: 'application/pdf', bytes: Buffer.from('pdf') })).toEqual([
      { text: 'Belge kimliği: doc-2\nBaşlık: PDF Karar' },
      { inlineData: { mimeType: 'application/pdf', data: Buffer.from('pdf').toString('base64') } },
    ])
  })

  it('rejects unsupported content explicitly', () => {
    expect(() => normalizeDocumentContent({ id: 'doc-3', title: 'Arşiv', mediaType: 'application/zip', bytes: Buffer.from('zip') })).toThrow('desteklenmeyen içerik')
  })
})
