import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { executePromptPatch } from '../../src/modules/topic-analysis/application/execute-prompt-patch'
import { PrismaReportDraftRepository } from '../../src/modules/topic-analysis/infrastructure/prisma-report-draft-repository'
import { PrismaTopicAnalysisRepository } from '../../src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'
import type { AiModelClient } from '../../src/modules/ai/application/ai-model-client'
import { AiProviderError } from '../../src/modules/ai/domain/ai-errors'

const prisma = new PrismaClient()
const topicRepository = new PrismaTopicAnalysisRepository(prisma)
const draftRepository = new PrismaReportDraftRepository(prisma)

const publishedSpec = {
  schemaVersion: 1, templateFamily: 'bulten-v2', reportId: '110926-01',
  topicId: '00000000-0000-4000-8000-000000000000', card: 'K1',
  documentTitle: 'İthalat Tebliği', issueNumber: '33367', displayDate: '11 Eylül 2026 Cuma',
  typeLabel: 'Değişiklik', title: 'İthalat Tebliğinde Değişiklik', summary: 'Özet metni.',
  affectedParties: ['İthalatçılar'], dates: ['11 Eylül 2026: Yürürlüğe girer.'], note: null,
  source: { label: 'T.C. Resmî Gazete', url: 'https://www.resmigazete.gov.tr/doc.htm' }, blocks: ['B1', 'B10'],
}

function objectStore(topicId: string) {
  return { getContent: async () => Buffer.from(JSON.stringify({ ...publishedSpec, topicId })) }
}

function stubModel(json: unknown): AiModelClient {
  return {
    generateStructured: vi.fn().mockResolvedValue({ json, providerRequestId: 'req-1', usage: { inputTokens: 10, outputTokens: 5 } }),
  }
}

async function seedRevisionRequest(message: string) {
  const run = await prisma.scanRun.create({
    data: {
      requestKey: crypto.randomUUID(), targetDate: new Date('2026-09-11T00:00:00.000Z'),
      editions: { create: { publicationDate: new Date('2026-09-11T00:00:00.000Z'), type: 'MAIN', indexUrl: 'https://www.resmigazete.gov.tr/11.09.2026', discoveryOrder: 0, documents: { create: { title: 'İthalat Tebliği', sourceUrl: 'https://www.resmigazete.gov.tr/doc.htm', publicationOrder: 0 } } } },
    },
    include: { editions: { include: { documents: true } } },
  })
  const document = run.editions[0]!.documents[0]!
  const job = await prisma.aiJob.create({ data: { scanRunId: run.id, kind: 'DOCUMENT_FILTER', status: 'COMPLETED', model: 'm', titlePromptVersion: 'v1', contentPromptVersion: 'v1', configurationHash: 'b'.repeat(64) } })
  await prisma.documentFilterDecision.create({ data: { aiJobId: job.id, documentId: document.id, titleDecision: 'IN', titleReason: 'İlgili', titleConfidence: 0.9, finalDecision: 'IN' } })
  const topic = (await topicRepository.ensureTopics(run.id))[0]!
  const analysis = await topicRepository.createAnalysisRevision({ topicId: topic.id, version: 1, status: 'PASS', analysisObjectKey: 'a.json', markdownObjectKey: 'a.md', model: 'm', promptVersion: 'v1', schemaVersion: 1, inputTokens: 1, outputTokens: 1 })
  await topicRepository.createReportRevision({ scanRunId: run.id, topicId: topic.id, analysisRevisionId: analysis.id, title: 'İthalat Tebliği', basename: `01-${topic.id}.html`, card: 'K1', version: 1, specObjectKey: 'r01/report-spec.json', htmlObjectKey: 'r01/report.html' })
  const request = await topicRepository.appendRevisionRequest({ topicId: topic.id, requestKey: crypto.randomUUID(), message, revisionKind: 'DIRECT_EDIT' })
  return { topicId: topic.id, messageId: request.messageId }
}

const deps = (topicId: string, aiModel: AiModelClient, maxAttempts = 1) => ({
  repository: topicRepository, draftRepository, objectStore: objectStore(topicId), aiModel, model: 'gemini-test', maxAttempts,
})

async function threadMessages(topicId: string) {
  const thread = await prisma.analysisThread.findUniqueOrThrow({ where: { topicId }, include: { messages: { orderBy: { createdAt: 'asc' } } } })
  return thread.messages
}

describe('executePromptPatch', () => {
  beforeEach(async () => { await prisma.scanRun.deleteMany() })
  afterAll(() => prisma.$disconnect())

  it('applies the model patch through the shared core and records it as AI-sourced', async () => {
    const { topicId, messageId } = await seedRevisionRequest('başlığı kısalt')
    const model = stubModel({ outcome: 'EDITS', edits: [{ path: 'title', value: 'Kısa Başlık' }] })

    await executePromptPatch({ topicId, messageId }, deps(topicId, model))

    const draft = await draftRepository.getOpenDraft(topicId)
    expect(draft?.edits).toHaveLength(1)
    expect(draft?.edits[0]).toMatchObject({ path: 'title', source: 'AI', prompt: 'başlığı kısalt', chatMessageId: messageId })
    expect((draft?.spec as { title: string }).title).toBe('Kısa Başlık')
  })

  it('never sends the evidence bundle, only the editable fields and the request', async () => {
    const { topicId, messageId } = await seedRevisionRequest('özeti sadeleştir')
    const model = stubModel({ outcome: 'EDITS', edits: [{ path: 'summary', value: 'Sade özet.' }] })

    await executePromptPatch({ topicId, messageId }, deps(topicId, model))

    const call = (model.generateStructured as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { parts: unknown }
    const serialised = JSON.stringify(call.parts)
    expect(serialised).toContain('Düzenlenebilir alanlar')
    expect(serialised).toContain('özeti sadeleştir')
    expect(serialised).not.toContain('issueNumber')
  })

  it('refuses a patch that names a locked field and says why', async () => {
    const { topicId, messageId } = await seedRevisionRequest('gazete sayısını düzelt')
    const model = stubModel({ outcome: 'EDITS', edits: [{ path: 'issueNumber', value: '99999' }] })

    await executePromptPatch({ topicId, messageId }, deps(topicId, model))

    expect(await draftRepository.getOpenDraft(topicId)).toBeNull()
    const messages = await threadMessages(topicId)
    expect(messages.at(-1)).toMatchObject({ kind: 'ERROR' })
    expect(messages.at(-1)?.content).toMatch(/değiştirilemez/)
  })

  it('escalates a request that changes evidenced facts to the analysis path', async () => {
    const { topicId, messageId } = await seedRevisionRequest('yeni bir yürürlük tarihi ekle')
    const model = stubModel({ outcome: 'NEEDS_ANALYSIS', reason: 'Tarih kanıta bağlıdır.' })

    await executePromptPatch({ topicId, messageId }, deps(topicId, model))

    expect(await draftRepository.getOpenDraft(topicId)).toBeNull()
    // The user asked for a change, so the request is handed on rather than dropped.
    const queued = await prisma.topicOutbox.findMany({ where: { topicId }, orderBy: { createdAt: 'asc' } })
    expect(queued.map((row) => row.command)).toEqual(['REVISE_FIELDS', 'REVISE_ANALYSIS'])
    const messages = await threadMessages(topicId)
    expect(messages.at(-1)?.content).toMatch(/Analiz revizyonu başlatıldı/)
  })

  it('does not escalate the same request twice when the command is redelivered', async () => {
    const { topicId, messageId } = await seedRevisionRequest('yeni bir yürürlük tarihi ekle')
    const model = stubModel({ outcome: 'NEEDS_ANALYSIS', reason: 'Tarih kanıta bağlıdır.' })

    await executePromptPatch({ topicId, messageId }, deps(topicId, model))
    await executePromptPatch({ topicId, messageId }, deps(topicId, model))

    const queued = await prisma.topicOutbox.findMany({ where: { topicId, command: 'REVISE_ANALYSIS' } })
    expect(queued).toHaveLength(1)
  })

  it('reports a malformed model response without touching the report', async () => {
    const { topicId, messageId } = await seedRevisionRequest('başlığı düzelt')
    const model = stubModel({ outcome: 'EDITS', spec: { title: 'tam rapor' } })

    await executePromptPatch({ topicId, messageId }, deps(topicId, model))

    expect(await draftRepository.getOpenDraft(topicId)).toBeNull()
    expect((await threadMessages(topicId)).at(-1)).toMatchObject({ kind: 'ERROR' })
    const execution = await prisma.topicAiExecution.findFirstOrThrow({ where: { topicId } })
    expect(execution.status).toBe('FAILED')
  })

  it('records a provider failure without leaving a half-applied draft', async () => {
    const { topicId, messageId } = await seedRevisionRequest('başlığı düzelt')
    const model: AiModelClient = {
      generateStructured: vi.fn().mockRejectedValue(new AiProviderError('RATE_LIMITED', true, 'Gemini yoğun.')),
    }

    await executePromptPatch({ topicId, messageId }, deps(topicId, model))

    expect(await draftRepository.getOpenDraft(topicId)).toBeNull()
    expect((await threadMessages(topicId)).at(-1)?.content).toMatch(/yoğun/)
  })

  it('adds a second patch to the same open draft', async () => {
    const { topicId, messageId } = await seedRevisionRequest('başlığı kısalt')
    await executePromptPatch({ topicId, messageId }, deps(topicId, stubModel({ outcome: 'EDITS', edits: [{ path: 'title', value: 'Kısa Başlık' }] })))
    const second = await topicRepository.appendRevisionRequest({ topicId, requestKey: crypto.randomUUID(), message: 'özeti sadeleştir', revisionKind: 'DIRECT_EDIT' })

    await executePromptPatch({ topicId, messageId: second.messageId }, deps(topicId, stubModel({ outcome: 'EDITS', edits: [{ path: 'summary', value: 'Sade özet.' }] })))

    const draft = await draftRepository.getOpenDraft(topicId)
    expect(draft?.edits.map((edit) => edit.path)).toEqual(['title', 'summary'])
    expect(await prisma.reportDraft.count({ where: { topicId, status: 'OPEN' } })).toBe(1)
  })

  it('queues a field revision rather than the superseded publication command', async () => {
    const { topicId } = await seedRevisionRequest('başlığı kısalt')

    const outbox = await prisma.topicOutbox.findFirstOrThrow({ where: { topicId } })

    expect(outbox.command).toBe('REVISE_FIELDS')
  })

  it('retries a transient provider error before giving up', async () => {
    const { topicId, messageId } = await seedRevisionRequest('başlığı kısalt')
    const generateStructured = vi.fn()
      .mockRejectedValueOnce(new AiProviderError('PROVIDER_UNAVAILABLE', true, 'Gemini servisi geçici olarak kullanılamıyor.'))
      .mockResolvedValue({ json: { outcome: 'EDITS', edits: [{ path: 'title', value: 'Kısa Başlık' }] }, providerRequestId: 'req-2', usage: { inputTokens: 5, outputTokens: 2 } })

    await executePromptPatch({ topicId, messageId }, deps(topicId, { generateStructured }, 3))

    expect(generateStructured).toHaveBeenCalledTimes(2)
    const draft = await draftRepository.getOpenDraft(topicId)
    expect(draft?.edits).toHaveLength(1)
    expect(await prisma.topicAiExecution.count({ where: { topicId, kind: 'PUBLICATION_REVISION' } })).toBe(2)
  })

  it('does not retry a malformed response, which another call would not fix', async () => {
    const { topicId, messageId } = await seedRevisionRequest('başlığı kısalt')
    const generateStructured = vi.fn().mockResolvedValue({ json: { outcome: 'REWRITE' }, providerRequestId: 'r', usage: { inputTokens: 1, outputTokens: 1 } })

    await executePromptPatch({ topicId, messageId }, deps(topicId, { generateStructured }, 3))

    expect(generateStructured).toHaveBeenCalledTimes(1)
  })
})
