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
})
