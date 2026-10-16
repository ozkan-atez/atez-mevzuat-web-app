import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  DEFAULT_RETRY_TIERS,
  StorageKeys,
  assertTestDatabaseUrl,
  buildTopology,
  canonicalJson,
  poolQueue,
  retryTierFor,
  toGeminiJsonSchema,
  topologyDefinitions,
} from '../src/index'

describe('test DB koruması (Ek B.3 madde 12)', () => {
  it('_test ile bitmeyen veritabanını reddeder', () => {
    expect(() => assertTestDatabaseUrl('postgres://u:p@h:5432/atez_v2')).toThrow(/_test/)
    expect(() => assertTestDatabaseUrl(undefined)).toThrow()
    expect(assertTestDatabaseUrl('postgres://u:p@h:5432/atez_v2_test')).toContain('atez_v2_test')
  })
})

describe('StorageKeys (§4.2)', () => {
  const sha = 'ab'.repeat(32)
  it('içerik adresli belge anahtarı', () => {
    expect(StorageKeys.documentFile(sha, 'PDF')).toBe(`documents/ab/${sha}.pdf`)
  })
  it('profil ve rapor anahtarları', () => {
    expect(StorageKeys.profile('dv1', 2)).toBe('artifacts/documents/dv1/profile.v2.json')
    expect(StorageKeys.reportFile('r1', 3, 'report.html')).toBe('artifacts/reports/r1/r03/report.html')
    expect(StorageKeys.topicAnalysis('t1', 12)).toBe('artifacts/topics/t1/analysis/r12.json')
  })
  it('geçersiz girdileri reddeder', () => {
    expect(() => StorageKeys.documentFile('xyz', 'pdf')).toThrow()
    expect(() => StorageKeys.profile('../x', 1)).toThrow()
    expect(() => StorageKeys.sourceFixture('rg', 1, '../../etc')).toThrow()
  })
})

describe('RabbitMQ topolojisi (§12)', () => {
  const spec = buildTopology()
  it('dört exchange ve havuz kuyrukları', () => {
    expect(spec.exchanges.map((e) => e.name)).toEqual(['atez.cmd', 'atez.evt', 'atez.retry', 'atez.dlx'])
    expect(poolQueue('ai-lite')).toBe('q.ai.lite')
    expect(spec.queues.map((q) => q.name)).toEqual(expect.arrayContaining(['q.io', 'q.doc', 'q.ai.lite', 'q.ai.main', 'q.orchestrator', 'q.parking', 'q.retry.10s', 'q.retry.1m', 'q.retry.10m']))
  })
  it('retry kuyrukları TTL + DLX → atez.cmd, havuz kuyrukları DLX → atez.dlx, hepsi quorum', () => {
    const r = spec.queues.find((q) => q.name === 'q.retry.1m')!
    expect(r.arguments).toMatchObject({ 'x-message-ttl': 60_000, 'x-dead-letter-exchange': 'atez.cmd', 'x-queue-type': 'quorum' })
    expect(spec.queues.find((q) => q.name === 'q.io')!.arguments).toMatchObject({ 'x-dead-letter-exchange': 'atez.dlx' })
  })
  it('adımlar routing key step.<key> ile havuz kuyruğuna bağlı', () => {
    expect(spec.bindings).toContainEqual(expect.objectContaining({ source: 'atez.cmd', destination: 'q.ai.main', routingKey: 'step.classify.profile' }))
  })
  it('kademeli gecikme seçimi', () => {
    expect(retryTierFor(DEFAULT_RETRY_TIERS, 1).label).toBe('10s')
    expect(retryTierFor(DEFAULT_RETRY_TIERS, 2).label).toBe('1m')
    expect(retryTierFor(DEFAULT_RETRY_TIERS, 9).label).toBe('10m')
  })
  it('definitions JSON üretir', () => {
    const d = topologyDefinitions('atez-mevzuat')
    expect(d.queues.every((q) => q.vhost === 'atez-mevzuat')).toBe(true)
  })
})

describe('yardımcılar', () => {
  it('canonicalJson anahtar sırasından bağımsız', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }))
  })
  it('Gemini JSON şeması desteklenmeyen anahtarları ayıklar', () => {
    const s = toGeminiJsonSchema(z.object({ d: z.string().regex(/^\d+$/) })) as { properties: { d: Record<string, unknown> } }
    expect(s.properties.d.pattern).toBeUndefined()
    expect(s.properties.d.type).toBe('string')
  })
})
