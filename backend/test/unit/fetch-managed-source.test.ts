import { describe, expect, it } from 'vitest'
import { isPublicIp, normalizeManagedSourceUrl } from '../../src/modules/managed-sources/fetch-managed-source'

describe('managed source URL policy', () => {
  it('normalizes public HTTPS links and drops fragments', () => {
    expect(normalizeManagedSourceUrl('https://www.example.org/guide#top')).toBe('https://www.example.org/guide')
  })

  it('rejects local schemes, credentials and nonstandard ports', () => {
    expect(() => normalizeManagedSourceUrl('http://example.org')).toThrow()
    expect(() => normalizeManagedSourceUrl('https://user:secret@example.org')).toThrow()
    expect(() => normalizeManagedSourceUrl('https://example.org:8443')).toThrow()
  })

  it('rejects private and reserved addresses before fetching', () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '172.16.1.1', '192.168.1.1', '169.254.1.1', '100.64.0.1', '::1', 'fc00::1', '2001:db8::1']) {
      expect(isPublicIp(address), address).toBe(false)
    }
    expect(isPublicIp('8.8.8.8')).toBe(true)
    expect(isPublicIp('2606:4700:4700::1111')).toBe(true)
  })
})
