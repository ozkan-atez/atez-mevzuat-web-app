import { PrismaClient } from '@prisma/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaChatRepository } from '../../src/modules/chat/infrastructure/prisma-chat-repository'
import { PrismaTopicAnalysisRepository } from '../../src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'

const prisma = new PrismaClient()
const repository = new PrismaChatRepository(prisma)
const topicRepository = new PrismaTopicAnalysisRepository(prisma)

async function seedTopicThread(message: string) {
  const run = await prisma.scanRun.create({
    data: {
      requestKey: crypto.randomUUID(), targetDate: new Date('2026-09-11T00:00:00.000Z'),
      editions: { create: { publicationDate: new Date('2026-09-11T00:00:00.000Z'), type: 'MAIN', indexUrl: 'https://www.resmigazete.gov.tr/11.09.2026', discoveryOrder: 0, documents: { create: { title: 'PET Reçine Tebliği', sourceUrl: 'https://www.resmigazete.gov.tr/doc.htm', publicationOrder: 0 } } } },
    },
    include: { editions: { include: { documents: true } } },
  })
  const document = run.editions[0]!.documents[0]!
  const job = await prisma.aiJob.create({ data: { scanRunId: run.id, kind: 'DOCUMENT_FILTER', status: 'COMPLETED', model: 'm', titlePromptVersion: 'v1', contentPromptVersion: 'v1', configurationHash: 'c'.repeat(64) } })
  await prisma.documentFilterDecision.create({ data: { aiJobId: job.id, documentId: document.id, titleDecision: 'IN', titleReason: 'İlgili', titleConfidence: 1, finalDecision: 'IN' } })
  const topic = (await topicRepository.ensureTopics(run.id))[0]!
  await topicRepository.appendRevisionRequest({ topicId: topic.id, requestKey: crypto.randomUUID(), message, revisionKind: 'DIRECT_EDIT' })
  const thread = await prisma.analysisThread.findUniqueOrThrow({ where: { topicId: topic.id } })
  return { threadId: thread.id, topicId: topic.id, runId: run.id }
}

describe('PrismaChatRepository', () => {
  beforeEach(async () => {
    await prisma.chatSession.deleteMany()
    await prisma.scanRun.deleteMany()
  })
  afterAll(() => prisma.$disconnect())

  it('keeps the first question as content and saves a generated title once', async () => {
    const session = await repository.createSession()
    await repository.appendMessage({ sessionId: session.id, role: 'USER', content: 'İthalat rejimi nedir?', status: 'COMPLETED' })
    await repository.appendMessage({ sessionId: session.id, role: 'ASSISTANT', content: 'İthalat rejimi…', status: 'COMPLETED' })

    expect(await repository.getMessages(session.id)).toMatchObject([
      { role: 'USER', content: 'İthalat rejimi nedir?', status: 'COMPLETED' },
      { role: 'ASSISTANT', content: 'İthalat rejimi…', status: 'COMPLETED' },
    ])
    expect((await repository.listHistory())[0]).toMatchObject({ id: session.id, title: 'Yeni sohbet', titlePending: true })
    const activityBeforeTitle = (await prisma.chatSession.findUniqueOrThrow({ where: { id: session.id } })).updatedAt
    await repository.setTitleIfMatches(session.id, null, 'İthalat Rejimi Esasları')
    await repository.setTitleIfMatches(session.id, null, 'Başka Başlık')
    expect(await repository.getSessionTitle(session.id)).toBe('İthalat Rejimi Esasları')
    expect((await prisma.chatSession.findUniqueOrThrow({ where: { id: session.id } })).updatedAt).toEqual(activityBeforeTitle)
    expect((await repository.listHistory())[0]).toMatchObject({
      id: session.id, type: 'GENERAL', title: 'İthalat Rejimi Esasları', titlePending: false, messageCount: 2, target: `/chat/${session.id}`,
    })
  })

  it('marks old first-message titles for background replacement', async () => {
    const session = await repository.createSession()
    await repository.appendMessage({ sessionId: session.id, role: 'USER', content: 'İthalat rejimi nedir?', status: 'COMPLETED' })
    await repository.appendMessage({ sessionId: session.id, role: 'ASSISTANT', content: 'İthalat rejimi…', status: 'COMPLETED' })
    await repository.setTitleIfMatches(session.id, null, 'İthalat rejimi nedir?')

    expect((await repository.listHistory())[0]).toMatchObject({ title: 'İthalat rejimi nedir?', titlePending: true })
    await repository.setTitleIfMatches(session.id, 'İthalat rejimi nedir?', 'İthalat Rejimi Esasları')
    expect((await repository.listHistory())[0]).toMatchObject({ title: 'İthalat Rejimi Esasları', titlePending: false })
  })

  it('rejects a message for a session that does not exist', async () => {
    await expect(repository.appendMessage({ sessionId: crypto.randomUUID(), role: 'USER', content: 'Merhaba', status: 'COMPLETED' }))
      .rejects.toThrow(/Sohbet bulunamadı/)
  })

  it('lists report revision threads with their report and owning run', async () => {
    const session = await repository.createSession()
    await repository.appendMessage({ sessionId: session.id, role: 'USER', content: 'GTİP nedir?', status: 'COMPLETED' })
    const { topicId, runId } = await seedTopicThread('PET reçine revizyonu')

    const history = await repository.listHistory()

    expect(history.map((item) => item.type).sort()).toEqual(['GENERAL', 'REPORT_REVISION'])
    expect(history.find((item) => item.type === 'REPORT_REVISION')).toMatchObject({
      title: 'PET Reçine Tebliği', target: `/reports/${topicId}`, preview: 'PET reçine revizyonu',
      run: { id: runId, targetDate: '2026-09-11T00:00:00.000Z', status: 'QUEUED' },
    })
  })

  it('never deletes a revision thread through general-session deletion', async () => {
    const session = await repository.createSession()
    const { threadId } = await seedTopicThread('PET reçine revizyonu')

    expect(await repository.deleteSession(threadId)).toBe(false)
    expect(await prisma.analysisThread.count({ where: { id: threadId } })).toBe(1)
    expect(await repository.deleteSession(session.id)).toBe(true)
    expect(await repository.sessionExists(session.id)).toBe(false)
  })
})
