import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { getConversationUsage, getUsageDetails, usageQuerySchema } from '../../src/modules/usage/usage-query'
import { PrismaUsageRecorder } from '../../src/modules/usage/prisma-usage-recorder'
import { emptyTokens } from '../../src/modules/usage/measurement'
import { permissionsForRole, runWithActorContext, type ActorContext } from '../../src/platform/actor-context'

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip
suite('conversation usage access and aggregation', () => {
  const prisma = new PrismaClient(), workspaces = [randomUUID(), randomUUID()], users = [randomUUID(), randomUUID(), randomUUID()]
  const sessions = [randomUUID(), randomUUID(), randomUUID()]
  const reportId = randomUUID(), runId = randomUUID(), topicId = randomUUID(), revisionMessage = randomUUID()
  const query = usageQuerySchema.parse({from: '2026-10-13', to: '2026-10-13'})
  const actor = (index: number, admin = false): ActorContext => ({userId: users[index]!, workspaceId: workspaces[index === 2 ? 1 : 0]!, identityId: 'test', role: admin ? 'ADMIN' : 'EDITOR', permissions: permissionsForRole(admin ? 'ADMIN' : 'EDITOR'), issuer: 'test', subject: 'test'})
  const own = <T>(action: () => T) => runWithActorContext(actor(0), action)
  beforeAll(async () => {
    for (const id of workspaces) await prisma.workspace.create({data: {id, key: `usage-${id}`, name: 'Usage test'}})
    for (let i = 0; i < 3; i++) {
      await prisma.user.create({data: {id: users[i]!, email: `usage-${users[i]}@example.invalid`, name: `User ${i}`}})
      await prisma.chatSession.create({data: {id: sessions[i]!, title: `Private ${i}`, workspaceId: workspaces[i === 2 ? 1 : 0]!, ownerId: users[i]!, visibility: 'PRIVATE'}})
      await runWithActorContext(actor(i), () => new PrismaUsageRecorder(prisma).save({...emptyTokens, id: randomUUID(), conversationId: sessions[i]!, conversationType: 'GENERAL', messageId: `m-${i}`, provider: 'gemini', model: 'test', mode: 'CHAT', status: 'COMPLETED', inputTokens: 100, outputTokens: 10, totalTokens: 120, reasoningTokens: 10, cachedTokens: 80, startedAt: new Date('2026-10-12T21:00:00Z'), completedAt: new Date('2026-10-12T21:00:03Z')}))
    }
    await own(() => new PrismaUsageRecorder(prisma).save({...emptyTokens, id: randomUUID(), conversationId: sessions[0]!, conversationType: 'GENERAL', messageId: 'm-0', provider: 'gemini', model: 'test-2', mode: 'CHAT', status: 'FAILED', inputTokens: 30, outputTokens: 10, totalTokens: 40, startedAt: new Date('2026-10-13T08:00:00Z'), completedAt: new Date('2026-10-13T08:00:01Z')}))
    await own(() => new PrismaUsageRecorder(prisma).save({...emptyTokens, id: randomUUID(), conversationId: sessions[0]!, conversationType: 'GENERAL', messageId: 'excluded', provider: 'gemini', model: 'test', mode: 'CHAT', status: 'COMPLETED', totalTokens: 9999, startedAt: new Date('2026-10-13T21:00:00Z'), completedAt: new Date('2026-10-13T21:00:01Z')}))
    await prisma.generalChatMessage.create({data: {sessionId: sessions[0]!, role: 'USER', content: 'Older question', createdAt: new Date('2026-10-13T06:00:00Z')}})
    await prisma.scanRun.create({data: {id: runId, requestKey: randomUUID(), targetDate: new Date('2026-10-13'), workspaceId: workspaces[0]!, initiatorUserId: users[1]!}})
    const edition = await prisma.gazetteEdition.create({data: {scanRunId: runId, publicationDate: new Date('2026-10-13'), type: 'MAIN', indexUrl: 'https://example.invalid', discoveryOrder: 1}})
    const document = await prisma.collectedDocument.create({data: {editionId: edition.id, title: 'Test', sourceUrl: 'https://example.invalid/test', publicationOrder: 1}})
    await prisma.topicProcess.create({data: {id: topicId, scanRunId: runId, documentId: document.id}})
    const thread = await prisma.analysisThread.create({data: {topicId}})
    await prisma.chatMessage.create({data: {id: revisionMessage, threadId: thread.id, workspaceId: workspaces[0]!, initiatorUserId: users[1]!, role: 'USER', kind: 'REVISION_REQUEST', content: 'Private report request'}})
    await prisma.topicReport.create({data: {id: reportId, topicId, scanRunId: runId, workspaceId: workspaces[0]!, ownerUserId: users[1]!, visibility: 'WORKSPACE', title: 'Shared report', basename: 'test', card: 'K6'}})
    await prisma.topicAiExecution.create({data: {topicId, requestMessageId: revisionMessage, kind: 'PUBLICATION_REVISION', attemptNo: 1, status: 'COMPLETED', model: 'revision-model', promptVersion: 'test', schemaVersion: 1, inputHash: 'a'.repeat(64), inputTokens: 25, outputTokens: 5, startedAt: new Date('2026-10-13T09:00:00Z')}})
  })
  afterAll(async () => {
    await prisma.chatUsageEvent.deleteMany({where: {workspaceId: {in: workspaces}}})
    await prisma.scanRun.deleteMany({where: {id: runId}})
    await prisma.chatSession.deleteMany({where: {id: {in: sessions}}})
    await prisma.user.deleteMany({where: {id: {in: users}}})
    await prisma.workspace.deleteMany({where: {id: {in: workspaces}}})
    await prisma.$disconnect()
  })
  it('sums each call once, counts distinct messages, and retains unknown historical usage', async () => {
    const result = await own(() => getConversationUsage(prisma, query))
    expect(result).toMatchObject({total: 1, teamAccess: false, summary: {inputTokens: 130, outputTokens: 20, totalTokens: 160, callCount: 2, unmeasuredCount: 1}})
    expect(result.rows).toEqual([expect.objectContaining({title: 'Private 0', messageCount: 2, target: `/chat/${sessions[0]}`})])
  })
  it('prevents user filters or direct conversation IDs from granting access', async () => {
    expect(await own(() => getConversationUsage(prisma, {...query, userId: users[1]!}))).toMatchObject({total: 0})
    expect(await own(() => getUsageDetails(prisma, {...query, conversationId: sessions[1]!, type: 'GENERAL'}))).toMatchObject({total: 0, rows: []})
    // Shared-report access does not grant access to other users’ usage records.
    expect(await own(() => getUsageDetails(prisma, {...query, conversationId: reportId, type: 'REPORT'}))).toMatchObject({total: 0})
  })
  it('allows admins team metrics but conceals private titles and excludes other workspaces', async () => {
    const result = await runWithActorContext(actor(0, true), () => getConversationUsage(prisma, query))
    expect(result).toMatchObject({total: 3, teamAccess: true, summary: {totalTokens: 310, callCount: 4}})
    expect(result.rows).toEqual(expect.arrayContaining([expect.objectContaining({conversationId: sessions[1], title: 'Özel sohbet', target: null}), expect.objectContaining({title: 'Shared report', totalTokens: 30, unmeasuredCount: 1})]))
    expect(JSON.stringify(result)).not.toContain('Private 1')
    expect(JSON.stringify(result)).not.toContain(users[2])
    expect(await runWithActorContext(actor(0, true), () => getConversationUsage(prisma, {...query, query: 'Private 1'}))).toMatchObject({total: 0})
  })
  it('returns timestamps and null totals for older revision calls', async () => {
    const result = await runWithActorContext(actor(1), () => getUsageDetails(prisma, {...query, conversationId: reportId, type: 'REPORT'}))
    expect(result).toMatchObject({total: 1, rows: [expect.objectContaining({actorUserId: users[1], inputTokens: 25, outputTokens: 5, totalTokens: null, mode: 'REVISION', startedAt: '2026-10-13T09:00:00'})]})
  })
  it('never reports an entirely unmeasured conversation as zero tokens', async () => {
    const session = await prisma.chatSession.create({data: {title: 'Only unknown', workspaceId: workspaces[0]!, ownerId: users[0]!, visibility: 'PRIVATE'}})
    try {
      await prisma.generalChatMessage.create({data: {sessionId: session.id, role: 'USER', content: 'Old question', createdAt: new Date('2026-10-13T06:00:00Z')}})
      const result = await own(() => getConversationUsage(prisma, {...query, query: 'Only unknown'}))
      expect(result).toMatchObject({total: 1, summary: {inputTokens: null, outputTokens: null, totalTokens: null, unmeasuredCount: 1}, rows: [expect.objectContaining({inputTokens: null, outputTokens: null, totalTokens: null})]})
    } finally { await prisma.chatSession.delete({where: {id: session.id}}) }
  })
  it('retains metering when a private conversation is deleted', async () => {
    await prisma.chatSession.delete({where: {id: sessions[2]!}})
    const result = await runWithActorContext(actor(2), () => getConversationUsage(prisma, query))
    expect(result).toMatchObject({total: 1, summary: {totalTokens: 120}, rows: [expect.objectContaining({title: 'Silinmiş sohbet', target: null})]})
  })
  it('includes automation and other AI calls with exact category totals and workspace isolation', async () => {
    const ids: string[] = []
    try {
      for (const [conversationType,totalTokens] of [['AUTOMATION',50],['TEMPLATE',20],['OPERATION',null]] as const) {
        const id=randomUUID();ids.push(id)
        await runWithActorContext({...actor(0,true),serviceActor:conversationType==='AUTOMATION'},()=>new PrismaUsageRecorder(prisma).save({...emptyTokens,id,conversationId:id,conversationType,messageId:id,usageLabel:'usage-v2-test',provider:'gemini',model:'test',mode:'ANALYSIS',status:'COMPLETED',totalTokens,startedAt:new Date('2026-10-13T12:00:00Z'),completedAt:new Date('2026-10-13T12:01:00Z')}))
      }
      const result=await runWithActorContext(actor(0,true),()=>getConversationUsage(prisma,{...query,query:'usage-v2-test',recordedOnly:'true'}))
      expect(result).toMatchObject({total:3,summary:{totalTokens:70,automationTokens:50,otherTokens:20,callCount:3,unmeasuredCount:1}})
      expect(result.rows).toEqual(expect.arrayContaining([expect.objectContaining({conversationType:'AUTOMATION',title:'usage-v2-test',target:null,users:[{id:null,name:null,email:null}]})]))
      expect(await runWithActorContext(actor(2,true),()=>getConversationUsage(prisma,{...query,query:'usage-v2-test',recordedOnly:'true'}))).toMatchObject({total:0})
    } finally {await prisma.chatUsageEvent.deleteMany({where:{id:{in:ids}}})}
  })
  it('counts a centrally recorded revision only once instead of also adding its legacy ledger', async () => {
    const id=randomUUID()
    try {
      await runWithActorContext(actor(1),()=>new PrismaUsageRecorder(prisma).save({...emptyTokens,id,conversationId:reportId,conversationType:'REPORT',messageId:revisionMessage,provider:'gemini',model:'test',mode:'REVISION',status:'COMPLETED',totalTokens:33,startedAt:new Date('2026-10-13T09:00:00Z'),completedAt:new Date('2026-10-13T09:01:00Z')}))
      expect(await runWithActorContext(actor(1),()=>getUsageDetails(prisma,{...query,conversationId:reportId,type:'REPORT'}))).toMatchObject({total:1,rows:[expect.objectContaining({id,totalTokens:33})]})
    }finally{await prisma.chatUsageEvent.delete({where:{id}})}
  })

})
