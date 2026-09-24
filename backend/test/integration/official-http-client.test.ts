import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SourcePolicy } from '../../src/modules/scan-runs/domain/source-policy'
import { OfficialHttpClient } from '../../src/modules/scan-runs/infrastructure/official-http-client'

const policy = new SourcePolicy(['resmigazete.gov.tr', 'www.resmigazete.gov.tr'])
const options = { delayMs: 750, timeoutMs: 5_000, maxAttempts: 3, maxFileBytes: 1_024 }

async function directory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'atez-http-test-'))
}

describe('OfficialHttpClient', () => {
  it('rejects an external redirect before requesting it', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'https://example.com/file.pdf' },
    }))
    const client = new OfficialHttpClient(policy, options, { fetch })

    await expect(client.download('https://www.resmigazete.gov.tr/file.pdf', await directory()))
      .rejects.toThrow('not allowed')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retries transient responses at most three times', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('%PDF-1.7\nvalid', { status: 200, headers: { 'content-type': 'application/pdf' } }))
    const sleep = vi.fn().mockResolvedValue(undefined)
    let now = 0
    const client = new OfficialHttpClient(policy, options, {
      fetch,
      sleep,
      random: () => 0,
      now: () => (now += 1_000),
    })

    const file = await client.download('https://www.resmigazete.gov.tr/file.pdf', await directory())

    expect(file.mediaType).toBe('application/pdf')
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('does not retry a missing file', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('missing', { status: 404 }))
    const client = new OfficialHttpClient(policy, options, { fetch, sleep: vi.fn() })

    await expect(client.download('https://www.resmigazete.gov.tr/file.pdf', await directory()))
      .rejects.toThrow('HTTP 404')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('retries temporary network failures without weakening validation', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('%PDF-1.7\nvalid', { status: 200, headers: { 'content-type': 'application/pdf' } }))
    const sleep = vi.fn().mockResolvedValue(undefined)
    const client = new OfficialHttpClient(policy, options, { fetch, sleep, random: () => 0 })

    const file = await client.download('https://www.resmigazete.gov.tr/file.pdf', await directory())

    expect(file.mediaType).toBe('application/pdf')
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })
})
