import { describe, expect, it, vi } from 'vitest'
import { enrichWithTariff } from '../../src/modules/topic-analysis/application/enrich-with-tariff'
import type { TopicEvidenceInput, TopicObjectStore, EvidenceContext } from '../../src/modules/topic-analysis/application/ports'
import type { AiModelClient } from '../../src/modules/ai/application/ai-model-client'

const topic: TopicEvidenceInput = { topicId: 'topic-1', runId: 'run-1', targetDate: '2026-09-23',
  document: { title: 'GTİP Kararı', sourceUrl: 'https://www.resmigazete.gov.tr/example.htm',
    object: { objectKey: 'current.html', sha256: 'a'.repeat(64), mediaType: 'text/html', byteSize: 60n }, assets: [] }, previousSource: null }
const evidence: EvidenceContext = { topicId: topic.topicId, signature: 'old', parts: [], aiParts: [], manifest: Buffer.from('{"schemaVersion":2,"parts":[]}') }

describe('Tariff analysis enrichment', () => {
  it('looks up all GTİPs found by the model and stores traceable supporting evidence', async () => {
    const files = new Map<string, Buffer>([['current.html', Buffer.from('<body>GTİP 6910.90 ve 8544.60.90.00.00</body>')]])
    const store: TopicObjectStore = {
      getContent: async (key) => files.get(key)!,
      putRunFile: async (key, body, mediaType) => { files.set(key, body); return { objectKey: key, sha256: 'b'.repeat(64), mediaType, byteSize: BigInt(body.length) } },
    }
    const model: AiModelClient = { generateStructured: async () => ({ json: { codes: ['691090000000', '854460900000'] }, providerRequestId: null, usage: { inputTokens: null, outputTokens: null } }) }
    const lookup = { lookup: vi.fn(async ({ code }: { code: string }) => ({ code, date: '2026-09-23', description: 'Ürün', source: 'https://tariff.singlewindow.io/api', fetchedAt: '2026-09-23T10:00:00Z', classification: 'SUPPORTING_NON_AUTHORITATIVE' as const, comparisons: [], notes: [] })) }
    const result = await enrichWithTariff({ topic, evidence: { ...evidence, aiParts: [] }, objectStore: store, aiModel: model, model: 'test', lookup })
    expect(lookup.lookup).toHaveBeenCalledTimes(2)
    expect(result.parts.map((part) => part.sourceId)).toEqual(['tariff:691090000000', 'tariff:854460900000'])
    expect(JSON.parse(result.manifest.toString('utf8')).tariff.results).toHaveLength(2)
    expect(result.aiParts.some((part) => 'text' in part && part.text.includes('Seramik'))).toBe(false)
    expect(result.aiParts.some((part) => 'text' in part && part.text.includes('SUPPORTING_NON_AUTHORITATIVE'))).toBe(true)
  })
})
