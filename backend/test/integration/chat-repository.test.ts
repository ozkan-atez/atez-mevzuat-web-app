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
  return { threadId: thread.id, topicId: topic.id }
}

describe('PrismaChatRepository', () => {
  beforeEach(async () => {
    await prisma.chatSession.deleteMany()
    await prisma.scanRun.deleteMany()
  })
  afterAll(() => prisma.$disconnect())

  it('creates a session, appends ordered messages, and titles it from the first question', async () => {
    const session = await repository.createSession()
    await repository.appendMessage({ sessionId: session.id, role: 'USER', content: 'İthalat rejimi nedir?', status: 'COMPLETED' })
    await repository.appendMessage({ sessionId: session.id, role: 'ASSISTANT', content: 'İthalat rejimi…', status: 'COMPLETED' })

    expect(await repository.getMessages(session.id)).toMatchObject([
      { role: 'USER', content: 'İthalat rejimi nedir?', status: 'COMPLETED' },
      { role: 'ASSISTANT', content: 'İthalat rejimi…', status: 'COMPLETED' },
    ])
    expect((await repository.listHistory())[0]).toMatchObject({
      id: session.id, type: 'GENERAL', title: 'İthalat rejimi nedir?', messageCount: 2, target: `/chat/${session.id}`,
    })
  })

  it('rejects a message for a session that does not exist', async () => {
    await expect(repository.appendMessage({ sessionId: crypto.randomUUID(), role: 'USER', content: 'Merhaba', status: 'COMPLETED' }))
      .rejects.toThrow(/Sohbet bulunamadı/)
  })

  it('lists report revision threads alongside general sessions, pointing at their report', async () => {
    const session = await repository.createSession()
    await repository.appendMessage({ sessionId: session.id, role: 'USER', content: 'GTİP nedir?', status: 'COMPLETED' })
    const { topicId } = await seedTopicThread('PET reçine revizyonu')

    const history = await repository.listHistory()

    expect(history.map((item) => item.type).sort()).toEqual(['GENERAL', 'REPORT_REVISION'])
    expect(history.find((item) => item.type === 'REPORT_REVISION')).toMatchObject({
      title: 'PET Reçine Tebliği', target: `/reports/${topicId}`, preview: 'PET reçine revizyonu',
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
