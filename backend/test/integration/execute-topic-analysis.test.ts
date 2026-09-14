import { describe, expect, it } from 'vitest'
import type { AiModelClient, StructuredAiRequest } from '../../src/modules/ai/application/ai-model-client'
import { AiProviderError } from '../../src/modules/ai/domain/ai-errors'
import { executeTopicAnalysis } from '../../src/modules/topic-analysis/application/execute-topic-analysis'
import type {
  CreateTopicAnalysisRevisionInput,
  TopicAnalysisRepository,
  TopicEvidenceInput,
  TopicObjectStore,
} from '../../src/modules/topic-analysis/application/ports'

const topicId = '11111111-1111-4111-8111-111111111111'

function validAnalysis() {
  return {
    schemaVersion: 1,
    topicId,
    status: 'PASS',
    document: { title: 'İthalat Kararı', gazetteDate: '2026-09-11', gazetteNumber: '33000', sourceUrl: 'https://www.resmigazete.gov.tr/current' },
    change: { type: 'AMENDMENT', detailedAnalysis: 'İthalat oranı değişmiştir.', summary: 'Yeni oran uygulanır.', currentRule: 'Oran yüzde ondur.', operationalImpact: 'Beyannameler güncellenir.' },
    affectedParties: [], effectiveDates: [], comparisons: [], tables: [],
    officialSources: [{ id: 'source-1', label: 'Resmî Gazete', url: 'https://www.resmigazete.gov.tr/current', evidenceIds: ['evidence-1'] }],
    supportingSources: [],
    evidence: [{ id: 'evidence-1', objectKey: 'objects/current.html', locator: 'paragraph:1' }],
    unresolvedReferences: [],
    emailTitle: 'İthalat oranı değişikliği', emailSummary: 'Yeni ithalat oranı uygulanacaktır.',
  }
}

class MemoryObjectStore implements TopicObjectStore {
  readonly values = new Map<string, Buffer>([['objects/current.html', Buffer.from('<html><body>Yeni oran yüzde ondur.</body></html>')]])
  async getContent(key: string) {
    const value = this.values.get(key)
    if (!value) throw new Error(`Missing ${key}`)
    return value
  }
  async putRunFile(key: string, body: Buffer, mediaType: string) {
    this.values.set(key, body)
    return { objectKey: key, sha256: 'f'.repeat(64), mediaType, byteSize: BigInt(body.byteLength) }
  }
  text(key: string) { return this.values.get(key)?.toString('utf8') ?? '' }
}

class MemoryRepository implements TopicAnalysisRepository {
  status = 'QUEUED'
  error: { category: string; message: string } | null = null
  revisions: CreateTopicAnalysisRevisionInput[] = []
  executions: Array<{ status: string; errorCategory?: string }> = []
  readonly topic: TopicEvidenceInput = {
    topicId, runId: 'run-1', targetDate: '2026-09-11',
    document: {
      title: 'İthalat Kararı', sourceUrl: 'https://www.resmigazete.gov.tr/current',
      object: { objectKey: 'objects/current.html', sha256: 'a'.repeat(64), mediaType: 'text/html', byteSize: 50n }, assets: [],
    },
    previousSource: null,
  }
  async getTopicEvidenceInput() { return this.topic }
  async markTopicAnalyzing() { this.status = 'ANALYZING' }
  async saveEvidenceBundle() {}
  async nextAnalysisVersion() { return this.revisions.length + 1 }
  async startTopicAiExecution() { const execution = { status: 'RUNNING' }; this.executions.push(execution); return { id: String(this.executions.length) } }
  async completeTopicAiExecution() { this.executions.at(-1)!.status = 'COMPLETED' }
  async failTopicAiExecution(_id: string, error: { category: string }) { Object.assign(this.executions.at(-1)!, { status: 'FAILED', errorCategory: error.category }) }
  async createAnalysisRevision(input: CreateTopicAnalysisRevisionInput) { this.revisions.push(input); this.status = 'ANALYZED'; return { id: 'revision-1', version: input.version } }
  async markTopicAwaitingRetry(_topicId: string, error: { category: string; message: string }) { this.status = 'AWAITING_RETRY'; this.error = error }
  async markTopicBlocked(_topicId: string, message: string) { this.status = 'BLOCKED'; this.error = { category: 'INVALID_RESPONSE', message } }
}

class FixedAi implements AiModelClient {
  calls = 0
  constructor(private readonly response: unknown | Error) {}
  async generateStructured(_request: StructuredAiRequest) {
    this.calls += 1
    if (this.response instanceof Error) throw this.response
    return { json: this.response, providerRequestId: 'gemini-response-1', usage: { inputTokens: 120, outputTokens: 80 } }
  }
}

function dependencies(ai: AiModelClient, repository = new MemoryRepository(), objectStore = new MemoryObjectStore()) {
  return { repository, objectStore, aiModel: ai, model: 'gemini-3.7-flash', maxAttempts: 2, maxContextBytes: 1_000_000, now: () => 100 }
}

describe('executeTopicAnalysis', () => {
  it('stores one validated JSON and generated Markdown for one topic', async () => {
    const repository = new MemoryRepository()
    const objectStore = new MemoryObjectStore()
    const result = await executeTopicAnalysis(topicId, dependencies(new FixedAi(validAnalysis()), repository, objectStore))
    expect(result.version).toBe(1)
    expect(objectStore.text(result.analysisObjectKey)).toContain(`"topicId":"${topicId}"`)
    expect(objectStore.text(result.markdownObjectKey)).toContain('## Belge kimliği')
    expect(repository.revisions).toHaveLength(1)
    expect(repository.executions[0]).toMatchObject({ status: 'COMPLETED' })
  })

  it('marks a retriable provider failure as awaiting retry with its category', async () => {
    const repository = new MemoryRepository()
    const ai = new FixedAi(new AiProviderError('RATE_LIMITED', true, 'Gemini geçici olarak yoğun.', 429))
    await expect(executeTopicAnalysis(topicId, dependencies(ai, repository))).rejects.toMatchObject({ category: 'RATE_LIMITED' })
    expect(ai.calls).toBe(2)
    expect(repository.status).toBe('AWAITING_RETRY')
    expect(repository.error).toMatchObject({ category: 'RATE_LIMITED' })
    expect(repository.revisions).toEqual([])
  })

  it('blocks malformed output without persisting a revision', async () => {
    const repository = new MemoryRepository()
    await expect(executeTopicAnalysis(topicId, dependencies(new FixedAi({ ...validAnalysis(), topics: [] }), repository))).rejects.toThrow()
    expect(repository.status).toBe('BLOCKED')
    expect(repository.revisions).toEqual([])
  })
})
