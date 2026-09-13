import { describe, expect, it } from 'vitest'
import { loadEnv } from '../../src/config/env'

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_REGION: 'eu-central-1',
  S3_BUCKET: 'resmi-gazete',
  S3_ACCESS_KEY_ID: 'local-access',
  S3_SECRET_ACCESS_KEY: 'local-secret',
}

describe('loadEnv', () => {
  it('applies the approved source defaults', () => {
    const env = loadEnv(base)
    expect(env.sourceHosts).toEqual(['resmigazete.gov.tr', 'www.resmigazete.gov.tr'])
    expect(env.sourceDelayMs).toBe(750)
    expect(env.sourceMaxAttempts).toBe(3)
    expect(env.timezone).toBe('Europe/Istanbul')
  })

  it('rejects a non-positive download limit', () => {
    expect(() => loadEnv({ ...base, MAX_FILE_BYTES: '0' })).toThrow()
  })

  it('applies Gemini filter defaults without requiring a development key', () => {
    const env = loadEnv({ ...base, GEMINI_API_KEY: '  ' })
    expect(env.gemini).toEqual({
      apiKey: undefined,
      model: 'gemini-3.8-flash',
      timeoutMs: 30_000,
      maxAttempts: 3,
      maxContentBytes: 8_000_000,
    })
  })
})
