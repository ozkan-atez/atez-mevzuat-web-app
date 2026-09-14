import { describe, expect, it } from 'vitest'
import { executeRunTopicAnalyses } from '../../src/modules/topic-analysis/application/execute-run-topic-analyses'
import type { AnalysisResult } from '../../src/modules/topic-analysis/domain/analysis-schemas'
import type { CreateTopicReportRevisionInput, RunReportContext, StoredTopicReport, TopicObjectStore } from '../../src/modules/topic-analysis/application/ports'

const runId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const topicIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
]

function analysis(topicId: string, status: AnalysisResult['status'] = 'PASS'): AnalysisResult {
  return {
    schemaVersion: 1, topicId, status,
    document: { title: `İthalat Tebliği ${topicId[0]}`, gazetteDate: '2026-09-11', gazetteNumber: '33000', sourceUrl: 'https://www.resmigazete.gov.tr/current' },
    change: { type: status === 'PASS' ? 'AMENDMENT' : 'NO_CHANGE', detailedAnalysis: 'Ayrıntılı inceleme.', summary: status === 'PASS' ? 'İthalat kuralı değişti.' : 'Raporlanabilir değişiklik bulunmadı.' },
    affectedParties: [], effectiveDates: [], comparisons: [], tables: [],
    officialSources: [{ id: 's1', label: 'T.C. Resmî Gazete', url: 'https://www.resmigazete.gov.tr/current', evidenceIds: ['e1'] }],
    supportingSources: [], evidence: [{ id: 'e1', objectKey: 'objects/current.html', locator: 'paragraph:1' }], unresolvedReferences: [],
    emailTitle: 'İthalat değişikliği', emailSummary: 'İthalat kuralı değişmiştir.',
  }
}

class MemoryObjectStore implements TopicObjectStore {
  readonly values = new Map<string, Buffer>([['index.html', Buffer.from('<h1>11 Eylül 2026 Tarihli ve 33000 Sayılı Resmî Gazete</h1>')]])
  async getContent(key: string) { const value = this.values.get(key); if (!value) throw new Error(`Missing ${key}`); return value }
  async putRunFile(key: string, body: Buffer, mediaType: string) { this.values.set(key, body); return { objectKey: key, sha256: 'f'.repeat(64), mediaType, byteSize: BigInt(body.length) } }
}

class MemoryRunRepository {
  readonly reports: CreateTopicReportRevisionInput[] = []
  readonly context: RunReportContext = { runId, targetDate: '2026-09-11', indexSourceUrl: 'https://www.resmigazete.gov.tr/eskiler/2026/09/20260911.htm', indexObjectKey: 'index.html', inspectedDocumentCount: 7 }
  constructor(readonly ids: string[]) {}
  async ensureTopics() { return this.ids.map((id) => ({ id, documentId: `doc-${id}`, status: 'QUEUED' })) }
  async getRunReportContext() { return this.context }
  async nextReportVersion() { return 1 }
  async createReportRevision(input: CreateTopicReportRevisionInput): Promise<StoredTopicReport> { this.reports.push(input); return { id: `report-${this.reports.length}`, revisionId: `revision-${this.reports.length}`, topicId: input.topicId, version: input.version, basename: input.basename, card: input.card, specObjectKey: input.specObjectKey, htmlObjectKey: input.htmlObjectKey } }
  async markTopicRendering() {}
  async markTopicValidating() {}
  async markTopicCompleted() {}
  async markTopicBlocked() {}
}

describe('executeRunTopicAnalyses', () => {
  it('processes every IN topic once with bounded concurrency', async () => {
    const repository = new MemoryRunRepository(topicIds)
    let active = 0
    let maximum = 0
    const result = await executeRunTopicAnalyses(runId, {
      repository,
      objectStore: new MemoryObjectStore(),
      concurrency: 2,
      executeTopic: async (topicId) => {
        active += 1
        maximum = Math.max(maximum, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return { id: `analysis-${topicId}`, version: 1, analysisObjectKey: 'analysis.json', markdownObjectKey: 'analysis.md', analysis: analysis(topicId) }
      },
    })
    expect(result.topicReports).toHaveLength(3)
    expect(new Set(result.topicReports.map((item) => item.topicId)).size).toBe(3)
    expect(maximum).toBeLessThanOrEqual(2)
    expect(result.status).toBe('COMPLETED')
  })

  it('creates only K6 and never calls topic analysis when no IN topic exists', async () => {
    const repository = new MemoryRunRepository([])
    let calls = 0
    const result = await executeRunTopicAnalyses(runId, {
      repository, objectStore: new MemoryObjectStore(), concurrency: 2,
      executeTopic: async () => { calls += 1; throw new Error('must not run') },
    })
    expect(calls).toBe(0)
    expect(result.noChangeReport?.basename).toBe('00-degisiklik-yok.html')
    expect(result.topicReports).toEqual([])
  })

  it('does not mix K6 with a PASS topic report', async () => {
    const repository = new MemoryRunRepository([topicIds[0]!])
    const result = await executeRunTopicAnalyses(runId, {
      repository, objectStore: new MemoryObjectStore(), concurrency: 1,
      executeTopic: async (topicId) => ({ id: 'analysis-1', version: 1, analysisObjectKey: 'analysis.json', markdownObjectKey: 'analysis.md', analysis: analysis(topicId) }),
    })
    expect(result.noChangeReport).toBeNull()
    expect(result.topicReports).toHaveLength(1)
  })
})
