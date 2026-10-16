import { runWithActorContext, permissionsForRole, type ActorContext } from '../../src/platform/actor-context'
import { PrismaReportDraftRepository } from '../../src/modules/topic-analysis/infrastructure/prisma-report-draft-repository'
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

  it('creates a session and replaces the pending title only once', async () => {
    const session = await repository.createSession()
    const first=await repository.appendMessage({ sessionId: session.id, role: 'USER', content: 'İthalat rejimi nedir?', status: 'COMPLETED' })
    expect(await repository.getTitleSeed(session.id,first.id)).toBe('İthalat rejimi nedir?')
    expect(await repository.getTitleSeed(session.id,'another-message')).toBeNull()
    await repository.setGeneratedTitle(session.id,'İthalat rejiminin esasları')
    await repository.setGeneratedTitle(session.id,'Geç gelen farklı başlık')
    expect(await repository.getTitleSeed(session.id,first.id)).toBeNull()
    await repository.appendMessage({ sessionId: session.id, role: 'ASSISTANT', content: 'İthalat rejimi…', status: 'COMPLETED' })

    expect(await repository.getMessages(session.id)).toMatchObject([
      { role: 'USER', content: 'İthalat rejimi nedir?', status: 'COMPLETED' },
      { role: 'ASSISTANT', content: 'İthalat rejimi…', status: 'COMPLETED' },
    ])
    expect((await repository.listHistory())[0]).toMatchObject({
      id: session.id, type: 'GENERAL', title: 'İthalat rejiminin esasları', messageCount: 2, target: `/chat/${session.id}`,
    })
  })

  it('rejects a message for a session that does not exist', async () => {
    await expect(repository.appendMessage({ sessionId: crypto.randomUUID(), role: 'USER', content: 'Merhaba', status: 'COMPLETED' }))
      .rejects.toThrow(/Sohbet bulunamadı/)
  })

  it('preserves attached version IDs and removes only conversation links when deleting a session', async () => {
    const session = await repository.createSession()
    const versionId = crypto.randomUUID()
    const message = await repository.appendMessage({ sessionId: session.id, role: 'USER', content: 'Bu belgeyi incele', status: 'COMPLETED', documentVersionIds: [versionId] })
    expect((await repository.getMessages(session.id))[0]?.documentVersionIds).toEqual([versionId])
    expect(await prisma.documentLink.findFirst({ where: { messageId: message.id } })).toMatchObject({ documentVersionId: versionId, sessionId: session.id, role: 'ATTACHMENT' })
    await repository.deleteSession(session.id)
    expect(await prisma.documentLink.count({ where: { messageId: message.id } })).toBe(0)
  })

  it('lists only user conversations while preserving report audit threads', async () => {
    const session = await repository.createSession()
    await repository.appendMessage({ sessionId: session.id, role: 'USER', content: 'GTİP nedir?', status: 'COMPLETED' })
    const { threadId } = await seedTopicThread('PET reçine revizyonu')

    const history = await repository.listHistory()

    expect(history.map(item => item.type)).toEqual(['GENERAL'])
    expect(await prisma.analysisThread.count({ where: { id: threadId } })).toBe(1)
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

 it('groups all report revisions for teammates with durable actor attribution and workspace isolation',async()=>{
  const suffix=crypto.randomUUID()
  const workspace=await prisma.workspace.create({data:{key:`report-${suffix}`,name:'Ekip'}})
  const other=await prisma.workspace.create({data:{key:`other-${suffix}`,name:'Başka ekip'}})
  const alice=await prisma.user.create({data:{email:`alice-${suffix}@example.invalid`,name:'Ayşe'}})
  const bob=await prisma.user.create({data:{email:`bob-${suffix}@example.invalid`,name:'Bora'}})
  const actor=(userId:string,workspaceId=workspace.id):ActorContext=>({userId,workspaceId,role:'EDITOR',permissions:permissionsForRole('EDITOR'),identityId:'test',issuer:'test',subject:userId})
  const {topicId,threadId}=await seedTopicThread('Önceki düzeltme')
  const topic=await prisma.topicProcess.findUniqueOrThrow({where:{id:topicId}})
  try {
   const report=await prisma.topicReport.create({data:{topicId,scanRunId:topic.scanRunId,title:'Ortak rapor',basename:'report.html',card:'K1',latestVersion:1,workspaceId:workspace.id,visibility:'WORKSPACE',revisions:{create:{version:1,status:'VALIDATED',card:'K1',specObjectKey:`${suffix}/spec1`,htmlObjectKey:`${suffix}/html1`}}}})
   const first=await runWithActorContext(actor(alice.id),()=>topicRepository.appendRevisionRequest({topicId,requestKey:crypto.randomUUID(),message:'Başlığı düzelt',revisionKind:'DIRECT_EDIT'}))
   await runWithActorContext(actor(bob.id),()=>topicRepository.appendRevisionRequest({topicId,requestKey:crypto.randomUUID(),message:'Özeti kısalt',revisionKind:'DIRECT_EDIT'}))
   const drafts=new PrismaReportDraftRepository(prisma)
   const draft=await runWithActorContext(actor(alice.id),()=>drafts.openDraft({topicId,baseVersion:1,spec:{title:'Yeni'},createdBy:null}))
   await runWithActorContext(actor(alice.id),()=>drafts.appendEdits({draftId:draft.id,spec:{title:'Yeni'},requestKey:null,source:'AI',prompt:'Başlığı düzelt',chatMessageId:first.messageId,edits:[{path:'title',previousValue:'Eski',nextValue:'Yeni',revertsEditId:null}]}))
   // Mark queued requests complete so the publication fence permits this fixture.
   for (const request of await prisma.chatMessage.findMany({where:{threadId,kind:'REVISION_REQUEST'}})) await topicRepository.appendRevisionResult(topicId,{role:'ASSISTANT',kind:'REVISION_RESULT',revisionKind:'DIRECT_EDIT',content:'Düzeltme taslağa işlendi.',requestKey:`patch-result:${request.id}`})
   await runWithActorContext(actor(bob.id),()=>topicRepository.createReportRevision({scanRunId:topic.scanRunId,topicId,analysisRevisionId:null,title:'Ortak rapor',basename:'report.html',card:'K1',version:2,specObjectKey:`${suffix}/spec2`,htmlObjectKey:`${suffix}/html2`,draftId:draft.id}))
   const history=await runWithActorContext(actor(bob.id),()=>repository.listHistory())
   expect(history.filter(item=>item.type==='REPORT_REVISION')).toHaveLength(1)
   expect(history.find(item=>item.type==='REPORT_REVISION')?.target).toBe(`/chat?report=${topicId}`)
   const saved=await runWithActorContext(actor(bob.id),()=>repository.getReportThread(topicId))
   expect(saved?.messages.filter(item=>item.content==='Başlığı düzelt')).toHaveLength(1)
   expect(saved?.messages.find(item=>item.content==='Başlığı düzelt')).toMatchObject({authorId:alice.id,authorName:'Ayşe',baseVersion:1,reportVersion:2,changePaths:['title']})
   expect(saved?.messages.find(item=>item.content==='Özeti kısalt')).toMatchObject({authorId:bob.id,authorName:'Bora'})
   expect((await prisma.reportFieldEdit.findFirst({where:{draftId:draft.id}}))?.actorId).toBe(alice.id)
   expect((await prisma.reportRevision.findUnique({where:{reportId_version:{reportId:report.id,version:2}}}))?.createdBy).toBe(bob.id)
   expect(await runWithActorContext(actor(bob.id,other.id),()=>repository.getReportThread(topicId))).toBeNull()
   expect((await runWithActorContext(actor(bob.id,other.id),()=>repository.listHistory())).some(item=>item.type==='REPORT_REVISION')).toBe(false)
   expect(await repository.deleteSession(threadId)).toBe(false)
  } finally {
   await prisma.scanRun.delete({where:{id:topic.scanRunId}})
   await prisma.user.deleteMany({where:{id:{in:[alice.id,bob.id]}}})
   await prisma.workspace.deleteMany({where:{id:{in:[workspace.id,other.id]}}})
  }
 })
