import { describe, expect, it } from 'vitest'
import { buildEvidenceBundle } from '../../src/modules/topic-analysis/application/build-evidence-bundle'
import type { TopicEvidenceInput, TopicObjectStore } from '../../src/modules/topic-analysis/application/ports'

const objects = new Map<string, Buffer>([
  ['objects/current.html', Buffer.from('<html><body><h1>Güncel düzenleme</h1><p>Yeni oran uygulanır.</p></body></html>')],
  ['objects/current.png', Buffer.from('current-image')],
  ['objects/previous.pdf', Buffer.from('%PDF-1.7 previous')],
  ['objects/previous.gif', Buffer.from('previous-image')],
])

const objectStore: TopicObjectStore = {
  async getContent(key) {
    const value = objects.get(key)
    if (!value) throw new Error(`Missing object: ${key}`)
    return value
  },
  async putRunFile() {
    throw new Error('Not used by this test')
  },
}

function topicFixture(): TopicEvidenceInput {
  return {
    topicId: '11111111-1111-4111-8111-111111111111',
    runId: 'run-1',
    targetDate: '2026-09-11',
    document: {
      title: 'Güncel düzenleme',
      sourceUrl: 'https://www.resmigazete.gov.tr/current',
      object: { objectKey: 'objects/current.html', sha256: 'a'.repeat(64), mediaType: 'text/html', byteSize: 100n },
      assets: [{ id: 'asset-1', sourceUrl: 'https://www.resmigazete.gov.tr/current.png', role: 'IMAGE', object: { objectKey: 'objects/current.png', sha256: 'b'.repeat(64), mediaType: 'image/png', byteSize: 10n } }],
    },
    previousSource: {
      title: 'Önceki düzenleme',
      sourceUrl: 'https://www.resmigazete.gov.tr/previous',
      object: { objectKey: 'objects/previous.pdf', sha256: 'c'.repeat(64), mediaType: 'application/pdf', byteSize: 20n },
      assets: [{ id: 'previous-asset-1', sourceUrl: 'https://www.resmigazete.gov.tr/previous.gif', role: 'IMAGE', object: { objectKey: 'objects/previous.gif', sha256: 'd'.repeat(64), mediaType: 'image/gif', byteSize: 10n } }],
    },
  }
}

describe('buildEvidenceBundle', () => {
  it('includes current and verified previous objects without crossing topic boundaries', async () => {
    const result = await buildEvidenceBundle(topicFixture(), objectStore, { maxContextBytes: 1_000_000 })
    expect(result.parts.map((part) => part.sourceId)).toEqual([
      'current-document', 'current-asset:asset-1', 'previous-document', 'previous-asset:previous-asset-1',
    ])
    expect(result.parts.every((part) => part.topicId === '11111111-1111-4111-8111-111111111111')).toBe(true)
    expect(result.signature).toMatch(/^[0-9a-f]{64}$/)
    expect(result.aiParts.some((part) => 'inlineData' in part && part.inlineData.mimeType === 'image/gif')).toBe(true)
  })

  it('rejects a bundle larger than the configured context limit', async () => {
    await expect(buildEvidenceBundle(topicFixture(), objectStore, { maxContextBytes: 5 })).rejects.toThrow(/bağlam sınırını/i)
  })
})
