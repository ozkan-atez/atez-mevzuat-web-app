import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createPreviousSourceExecutor } from '../../src/modules/operations/previous-source-executor'
import type { ObjectStore } from '../../src/modules/scan-runs/application/ports'

const intent = {needsPreviousSource:false,relationship:'NONE',targetRegulationTitle:null,targetRegulationIdentifier:null,targetRegulationType:null,targetInstitution:null,targetArticleReferences:[],queryCandidates:[],reason:'Önceki kaynak gerekmiyor.'}
describe('independent previous source operation', () => {
  it('records a successful no-reference result without discovery, capture or analysis', async () => {
    const prisma = { documentVersion:{findMany:vi.fn().mockResolvedValue([{id:'v',extractedText:'Yeni düzenleme.',document:{publishedOn:new Date('2026-10-10'),canonicalUrl:null,title:'Kullanıcı belgesi'}}])} } as unknown as PrismaClient
    const generateStructured=vi.fn().mockResolvedValue({json:intent,providerRequestId:null,usage:{inputTokens:1,outputTokens:1}})
    const search={search:vi.fn(),resolveDocumentUrl:vi.fn()}, putRunFile=vi.fn()
    const executor=createPreviousSourceExecutor({prisma,model:'fake',aiModel:{generateStructured},search,objectStore:{putRunFile} as unknown as ObjectStore})
    const result=await executor({operation:'PREVIOUS_SOURCES',mode:'FILL_MISSING',documentVersionIds:['v']},{taskId:'t',actorScope:'local-workspace',signal:new AbortController().signal})
    expect(result).toEqual([{kind:'PREVIOUS_SOURCES',data:{documentVersionId:'v',outcome:'NOT_REQUIRED',intent}}])
    expect(search.search).not.toHaveBeenCalled()
    expect(putRunFile).not.toHaveBeenCalled()
    expect(generateStructured).toHaveBeenCalledTimes(1)
  })
  it('does not invent a publication date for an uploaded document', async () => {
    const prisma={documentVersion:{findMany:vi.fn().mockResolvedValue([{id:'v',extractedText:'metin',document:{publishedOn:null}}])}} as unknown as PrismaClient
    const generateStructured=vi.fn()
    const executor=createPreviousSourceExecutor({prisma,model:'fake',aiModel:{generateStructured},search:{search:vi.fn(),resolveDocumentUrl:vi.fn()},objectStore:{} as ObjectStore})
    await expect(executor({operation:'PREVIOUS_SOURCES',mode:'FILL_MISSING',documentVersionIds:['v']},{taskId:'t',actorScope:'local-workspace',signal:new AbortController().signal})).rejects.toMatchObject({category:'DATE_REQUIRED'})
    expect(generateStructured).not.toHaveBeenCalled()
  })
})
