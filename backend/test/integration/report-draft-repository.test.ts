import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaReportDraftRepository } from '../../src/modules/topic-analysis/infrastructure/prisma-report-draft-repository'
import { PrismaTopicAnalysisRepository } from '../../src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'

const prisma = new PrismaClient()
const drafts = new PrismaReportDraftRepository(prisma)
const topics = new PrismaTopicAnalysisRepository(prisma)

async function seedPublishedReport() {
  const run = await prisma.scanRun.create({
    data: {
      requestKey: crypto.randomUUID(), targetDate: new Date('2026-09-11T00:00:00.000Z'),
      editions: {
        create: {
          publicationDate: new Date('2026-09-11T00:00:00.000Z'), type: 'MAIN',
          indexUrl: 'https://www.resmigazete.gov.tr/11.09.2026', discoveryOrder: 0,
          documents: { create: { title: 'İthalat Tebliği', sourceUrl: 'https://www.resmigazete.gov.tr/doc.htm', publicationOrder: 0 } },
        },
      },
    },
    include: { editions: { include: { documents: true } } },
  })
  const document = run.editions[0]!.documents[0]!
  const job = await prisma.aiJob.create({ data: { scanRunId: run.id, kind: 'DOCUMENT_FILTER', status: 'COMPLETED', model: 'm', titlePromptVersion: 'v1', contentPromptVersion: 'v1', configurationHash: 'b'.repeat(64) } })
  await prisma.documentFilterDecision.create({ data: { aiJobId: job.id, documentId: document.id, titleDecision: 'IN', titleReason: 'İlgili', titleConfidence: 0.9, finalDecision: 'IN' } })
  const topic = (await topics.ensureTopics(run.id))[0]!
  const analysis = await topics.createAnalysisRevision({ topicId: topic.id, version: 1, status: 'PASS', analysisObjectKey: 'a.json', markdownObjectKey: 'a.md', model: 'm', promptVersion: 'v1', schemaVersion: 1, inputTokens: 1, outputTokens: 1 })
  await topics.createReportRevision({
    scanRunId: run.id, topicId: topic.id, analysisRevisionId: analysis.id, title: 'İthalat Tebliği',
    basename: `01-${topic.id}.html`, card: 'K1', version: 1, specObjectKey: 'r01/report-spec.json', htmlObjectKey: 'r01/report.html',
  })
  return { topicId: topic.id, runId: run.id }
}

describe('report draft repository', () => {
  beforeEach(async () => { await prisma.scanRun.deleteMany() })
  afterAll(() => prisma.$disconnect())

  it('bases a draft on the latest validated revision', async () => {
    const { topicId, runId } = await seedPublishedReport()

    const base = await drafts.getPublishedBase(topicId)

    expect(base).toMatchObject({ runId, version: 1, targetDate: '2026-09-11', specObjectKey: 'r01/report-spec.json' })
    expect(base?.analysisRevisionId).toBeTruthy()
  })

  it('keeps one open draft per report even when two requests race', async () => {
    const { topicId } = await seedPublishedReport()

    const [first, second] = await Promise.all([
      drafts.openDraft({ topicId, baseVersion: 1, spec: { title: 'a' }, createdBy: null }),
      drafts.openDraft({ topicId, baseVersion: 1, spec: { title: 'a' }, createdBy: null }),
    ])

    expect(first.id).toBe(second.id)
    expect(await prisma.reportDraft.count({ where: { topicId, status: 'OPEN' } })).toBe(1)
  })

  it('numbers appended edits in order across separate patches', async () => {
    const { topicId } = await seedPublishedReport()
    const draft = await drafts.openDraft({ topicId, baseVersion: 1, spec: { title: 'a' }, createdBy: null })

    await drafts.appendEdits({
      draftId: draft.id, spec: { title: 'b' }, requestKey: crypto.randomUUID(), source: 'USER', prompt: null, chatMessageId: null,
      edits: [{ path: 'title', previousValue: 'a', nextValue: 'b', revertsEditId: null }],
    })
    const after = await drafts.appendEdits({
      draftId: draft.id, spec: { title: 'b', summary: 'y' }, requestKey: crypto.randomUUID(), source: 'AI', prompt: 'özeti düzelt', chatMessageId: null,
      edits: [
        { path: 'summary', previousValue: 'x', nextValue: 'y', revertsEditId: null },
        { path: 'note', previousValue: null, nextValue: 'n', revertsEditId: null },
      ],
    })

    expect(after.edits.map((edit) => edit.sequence)).toEqual([1, 2, 3])
    expect(after.edits.map((edit) => edit.path)).toEqual(['title', 'summary', 'note'])
    expect(after.spec).toEqual({ title: 'b', summary: 'y' })
    expect(after.edits[1]?.prompt).toBe('özeti düzelt')
  })

  it('stores the idempotency key on later patches too, not just the first', async () => {
    const { topicId } = await seedPublishedReport()
    const draft = await drafts.openDraft({ topicId, baseVersion: 1, spec: { title: 'a' }, createdBy: null })
    await drafts.appendEdits({
      draftId: draft.id, spec: { title: 'b' }, requestKey: crypto.randomUUID(), source: 'USER', prompt: null, chatMessageId: null,
      edits: [{ path: 'title', previousValue: 'a', nextValue: 'b', revertsEditId: null }],
    })
    const secondKey = crypto.randomUUID()

    await drafts.appendEdits({
      draftId: draft.id, spec: { title: 'b', summary: 'y' }, requestKey: secondKey, source: 'USER', prompt: null, chatMessageId: null,
      edits: [{ path: 'summary', previousValue: 'x', nextValue: 'y', revertsEditId: null }],
    })

    expect(await drafts.findDraftByRequestKey(secondKey)).toMatchObject({ id: draft.id })
  })

  it('records a revert as a new edit and links it to the one it undoes', async () => {
    const { topicId } = await seedPublishedReport()
    const draft = await drafts.openDraft({ topicId, baseVersion: 1, spec: { title: 'a' }, createdBy: null })
    const withEdit = await drafts.appendEdits({
      draftId: draft.id, spec: { title: 'b' }, requestKey: null, source: 'USER', prompt: null, chatMessageId: null,
      edits: [{ path: 'title', previousValue: 'a', nextValue: 'b', revertsEditId: null }],
    })
    const original = withEdit.edits[0]!

    const reverted = await drafts.appendEdits({
      draftId: draft.id, spec: { title: 'a' }, requestKey: null, source: 'USER', prompt: null, chatMessageId: null,
      edits: [{ path: 'title', previousValue: 'b', nextValue: 'a', revertsEditId: original.id }],
    })

    expect(reverted.edits).toHaveLength(2)
    expect(reverted.edits[0]?.revertedByEditId).toBe(reverted.edits[1]?.id)
    expect(reverted.edits[1]?.revertsEditId).toBe(original.id)
  })

  it('refuses edits once the draft is closed', async () => {
    const { topicId } = await seedPublishedReport()
    const draft = await drafts.openDraft({ topicId, baseVersion: 1, spec: { title: 'a' }, createdBy: null })
    await drafts.closeDraft(draft.id, 'PUBLISHED')

    await expect(drafts.appendEdits({
      draftId: draft.id, spec: { title: 'b' }, requestKey: null, source: 'USER', prompt: null, chatMessageId: null,
      edits: [{ path: 'title', previousValue: 'a', nextValue: 'b', revertsEditId: null }],
    })).rejects.toThrow(/kapanmış/)

    expect(await drafts.getOpenDraft(topicId)).toBeNull()
  })

  it('lets a new draft open after the previous one is published', async () => {
    const { topicId } = await seedPublishedReport()
    const first = await drafts.openDraft({ topicId, baseVersion: 1, spec: { title: 'a' }, createdBy: null })
    await drafts.closeDraft(first.id, 'PUBLISHED')

    const second = await drafts.openDraft({ topicId, baseVersion: 2, spec: { title: 'b' }, createdBy: null })

    expect(second.id).not.toBe(first.id)
    expect(second.baseVersion).toBe(2)
  })
})
