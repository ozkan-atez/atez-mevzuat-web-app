import { describe, expect, it } from 'vitest'
import { selectCandidateLinks } from '../../src/modules/managed-sources/source-discovery.routes'
import { normalizeManagedSourceUrl } from '../../src/modules/managed-sources/fetch-managed-source'

describe('source discovery boundaries', () => {
  it('only accepts existing candidate indexes and deduplicates model output', () => {
    const links = [
      { url: 'https://ticaret.gov.tr/duyurular', title: 'Duyurular' },
      { url: 'https://ticaret.gov.tr/mevzuat', title: 'Mevzuat' },
    ]
    expect(selectCandidateLinks(links, [1, 1, -1, 99, 0, 1])).toEqual([links[1], links[0]])
  })

  it('rejects local and non-HTTPS endpoints before fetching', () => {
    expect(() => normalizeManagedSourceUrl('http://ticaret.gov.tr')).toThrow()
    expect(() => normalizeManagedSourceUrl('https://127.0.0.1/admin')).toThrow()
    expect(() => normalizeManagedSourceUrl('https://localhost/admin')).toThrow()
  })
})
