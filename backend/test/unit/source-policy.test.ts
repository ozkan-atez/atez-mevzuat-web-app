import { describe, expect, it } from 'vitest'
import { SourcePolicy } from '../../src/modules/scan-runs/domain/source-policy'

describe('official source policy', () => {
  const policy = new SourcePolicy(['resmigazete.gov.tr', 'www.resmigazete.gov.tr'])

  it('accepts official HTTPS URLs', () => {
    expect(policy.assertAllowedUrl('https://www.resmigazete.gov.tr/eskiler/2026/07/20260711.htm').hostname)
      .toBe('www.resmigazete.gov.tr')
  })

  it.each([
    'http://www.resmigazete.gov.tr/eskiler/2026/07/file.pdf',
    'https://example.com/file.pdf',
    'https://www.resmigazete.gov.tr/eskiler/2026/07/../06/file.pdf',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => policy.assertAllowedUrl(url)).toThrow()
  })

  it('rejects a URL outside the document directory', () => {
    expect(() => policy.assertAllowedUrl(
      'https://www.resmigazete.gov.tr/eskiler/2026/06/file.pdf',
      'https://www.resmigazete.gov.tr/eskiler/2026/07/document.htm',
    )).toThrow('document directory')
  })
})
