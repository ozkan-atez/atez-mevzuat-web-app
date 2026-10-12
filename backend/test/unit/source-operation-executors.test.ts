import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
const mocks=vi.hoisted(()=>({profile:vi.fn(),login:vi.fn(),session:vi.fn(),collect:vi.fn(),capture:vi.fn(),ai:vi.fn(),process:vi.fn()}))
vi.mock('../../src/modules/managed-sources/source-profile-store',()=>({activeSourceProfile:mocks.profile}))
vi.mock('../../src/modules/managed-sources/source-secrets',()=>({sourceLogin:mocks.login}))
vi.mock('../../src/modules/managed-sources/source-session',()=>({openSourceSession:mocks.session}))
vi.mock('../../src/modules/managed-sources/source-collector',()=>({collectSource:mocks.collect}))
vi.mock('../../src/modules/managed-sources/source-attachments',()=>({captureSourceDocument:mocks.capture}))
import { createSourceOperationExecutors, sourceArtifactIsComplete } from '../../src/modules/operations/source-executors'
const context=()=>({taskId:'task',actorScope:'local-workspace',signal:new AbortController().signal})
const source={id:'source',key:'test-source',baseUrl:'https://example.org/',isActive:true}
const profile={id:'profile',version:3,config:{allowedHosts:['www.example.org'],feeds:[{url:'https://example.org/list'}]}}
const close=vi.fn()
const db=()=>({source:{findFirst:vi.fn(async()=>source)},sourceObservation:{upsert:vi.fn(),findFirst:vi.fn(async()=>({title:'Document title',publishedOn:new Date('2026-10-11T00:00:00Z')}))},sourceCoverage:{create:vi.fn()},document:{findFirst:vi.fn(async()=>null),upsert:vi.fn(async()=>({id:'document',actorScope:'local-workspace'}))},storedObject:{upsert:vi.fn(async()=>({id:'stored'}))},documentVersion:{upsert:vi.fn(async()=>({id:'version'}))}})
beforeEach(()=>{
  vi.clearAllMocks();mocks.profile.mockResolvedValue(profile);mocks.login.mockResolvedValue(null);mocks.session.mockResolvedValue({close,binary:vi.fn()});
  mocks.collect.mockResolvedValue({items:[],pages:['https://example.org/list'],warnings:[],notes:[]})
})
describe('source stages run independently',()=>{
  it('discover completes a verified empty day without capture, AI or START_SCAN',async()=>{
    const prisma=db();const store={putRunFile:vi.fn()};const executors=createSourceOperationExecutors({prisma:prisma as unknown as PrismaClient,objectStore:store})
    const artifacts=await executors.DISCOVER!({operation:'DISCOVER',mode:'FILL_MISSING',documentVersionIds:[],sourceId:'source',date:'2026-10-11'},context())
    expect(artifacts).toMatchObject([{kind:'DISCOVERY',data:{coverage:'COMPLETE',items:[]}}]);expect(prisma.sourceCoverage.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'COMPLETE',datePolicy:'PUBLISHED_DATE',taskId:'task'})}))
    expect(mocks.capture).not.toHaveBeenCalled();expect(store.putRunFile).not.toHaveBeenCalled();expect(mocks.ai).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce()
  })
  it('keeps inventory observations but excludes wrong and unknown dates from a dated result',async()=>{
    const items=[{url:'https://example.org/a',title:'A',publishedOn:'2026-10-11'},{url:'https://example.org/b',title:'B',publishedOn:'2026-10-10'},{url:'https://example.org/c',title:'C',publishedOn:null}]
    mocks.collect.mockResolvedValue({items,pages:['https://example.org/list'],warnings:[],notes:[]})
    const prisma=db();const executors=createSourceOperationExecutors({prisma:prisma as unknown as PrismaClient,objectStore:{putRunFile:vi.fn()}})
    const artifacts=await executors.DISCOVER!({operation:'DISCOVER',mode:'FORCE',documentVersionIds:[],sourceId:'source',date:'2026-10-11'},context())
    expect(prisma.sourceObservation.upsert).toHaveBeenCalledTimes(3);expect((artifacts[0]!.data as any).items).toEqual([items[0]])
  })
  it('records partial coverage as partial and never reuses it as complete coverage',async()=>{
    mocks.collect.mockResolvedValue({items:[],pages:['https://example.org/list'],warnings:['Second page unavailable'],notes:[]})
    const prisma=db();const executors=createSourceOperationExecutors({prisma:prisma as unknown as PrismaClient,objectStore:{putRunFile:vi.fn()}})
    const artifacts=await executors.DISCOVER!({operation:'DISCOVER',mode:'FILL_MISSING',documentVersionIds:[],sourceId:'source',date:'2026-10-11'},context())
    expect(sourceArtifactIsComplete('DISCOVER',artifacts)).toBe(false);expect(prisma.sourceCoverage.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'PARTIAL'})}));expect(close).toHaveBeenCalledOnce()
  })
  it('fails unreadable coverage instead of inventing an empty complete day',async()=>{
    mocks.collect.mockResolvedValue({items:[],pages:[],warnings:['Access denied']})
    const prisma=db();const executors=createSourceOperationExecutors({prisma:prisma as unknown as PrismaClient,objectStore:{putRunFile:vi.fn()}})
    await expect(executors.DISCOVER!({operation:'DISCOVER',mode:'FORCE',documentVersionIds:[],sourceId:'source',date:'2026-10-11'},context())).rejects.toMatchObject({category:'COVERAGE_INCOMPLETE'})
    expect(prisma.sourceCoverage.create).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce()
  })
  it('capture archives immutable bytes without discovery, extraction, filtering or AI',async()=>{
    mocks.capture.mockResolvedValue({status:'COMPLETED',errors:[],files:[{role:'DOCUMENT',status:'STORED',url:'https://example.org/a.pdf',title:'A',sha256:'a'.repeat(64),objectKey:'secret-key',bucket:'secret-bucket',mediaType:'application/pdf',byteSize:100}]})
    const prisma=db();const executors=createSourceOperationExecutors({prisma:prisma as unknown as PrismaClient,objectStore:{putRunFile:vi.fn()}})
    const artifacts=await executors.CAPTURE!({operation:'CAPTURE',mode:'FORCE',documentVersionIds:[],sourceId:'source',date:'2026-10-11',url:'https://example.org/a.pdf'},context())
    expect(prisma.documentVersion.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({extractionStatus:'PENDING'})}));expect(mocks.collect).not.toHaveBeenCalled();expect(mocks.ai).not.toHaveBeenCalled();expect(artifacts.some(a=>a.kind==='DOCUMENT_VERSION'&&a.referenceId==='version')).toBe(true)
    expect(JSON.stringify(artifacts)).not.toContain('secret-key');expect(JSON.stringify(artifacts)).not.toContain('secret-bucket');expect(close).toHaveBeenCalledOnce()
  })
  it('a stored main document cannot skip missing attachment capture',async()=>{
    const prisma=db();prisma.document.findFirst.mockResolvedValue({id:'document',versions:[{id:'v-existing',storedObjectId:'stored'}]} as any)
    mocks.capture.mockResolvedValue({status:'COMPLETED',errors:[],files:[{role:'DOCUMENT',status:'STORED',url:'https://example.org/a.pdf',title:'A',sha256:'a'.repeat(64),objectKey:'key',bucket:'test',mediaType:'application/pdf',byteSize:100}]})
    const executors=createSourceOperationExecutors({prisma:prisma as unknown as PrismaClient,objectStore:{putRunFile:vi.fn()}})
    await executors.CAPTURE!({operation:'CAPTURE',mode:'FILL_MISSING',documentVersionIds:[],sourceId:'source',url:'https://example.org/a.pdf'},context())
    expect(mocks.session).toHaveBeenCalledOnce();expect(mocks.capture).toHaveBeenCalledOnce();expect(mocks.collect).not.toHaveBeenCalled()
  })
  it('rejects a changed profile before source login or network activity',async()=>{
    const executors=createSourceOperationExecutors({prisma:db() as unknown as PrismaClient,objectStore:{putRunFile:vi.fn()}})
    for(const operation of ['DISCOVER','CAPTURE'] as const) await expect(executors[operation]!({operation,mode:'FORCE',documentVersionIds:[],sourceId:'source',date:'2026-10-11',url:'https://example.org/a.pdf',profileVersion:2},context())).rejects.toMatchObject({category:'PROFILE_CHANGED'})
    expect(mocks.login).not.toHaveBeenCalled();expect(mocks.session).not.toHaveBeenCalled()
  })
  it('rejects mismatched date and off-source URL before downloads',async()=>{
    const prisma=db();const executors=createSourceOperationExecutors({prisma:prisma as unknown as PrismaClient,objectStore:{putRunFile:vi.fn()}})
    await expect(executors.CAPTURE!({operation:'CAPTURE',mode:'FORCE',documentVersionIds:[],sourceId:'source',date:'2026-10-10',url:'https://example.org/a.pdf'},context())).rejects.toThrow('yayın tarihi')
    await expect(executors.CAPTURE!({operation:'CAPTURE',mode:'FORCE',documentVersionIds:[],sourceId:'source',url:'https://unrelated.org/a.pdf'},context())).rejects.toThrow('kaynak kapsamına')
    expect(mocks.capture).not.toHaveBeenCalled();expect(mocks.session).not.toHaveBeenCalled()
  })
  it('accepts a publisher alias explicitly allowed by the verified profile',async()=>{
    const executors=createSourceOperationExecutors({prisma:db() as unknown as PrismaClient,objectStore:{putRunFile:vi.fn()}})
    mocks.capture.mockResolvedValue({status:'FAILED',errors:['Unavailable'],files:[]})
    await expect(executors.CAPTURE!({operation:'CAPTURE',mode:'FORCE',documentVersionIds:[],sourceId:'source',url:'https://www.example.org/a.pdf'},context())).rejects.toMatchObject({category:'CAPTURE_FAILED'})
    expect(mocks.capture).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce()
  })
  it('does not cache partial attachments as a fully completed capture',()=>{
    expect(sourceArtifactIsComplete('CAPTURE',[{kind:'CAPTURE',data:{status:'PARTIAL'}},{kind:'DOCUMENT_VERSION'}])).toBe(false)
    expect(sourceArtifactIsComplete('CAPTURE',[{kind:'CAPTURE',data:{status:'COMPLETED'}}])).toBe(true)
    expect(sourceArtifactIsComplete('DISCOVER',[{kind:'DISCOVERY',data:{coverage:'COMPLETE',items:[]}}])).toBe(true)
    expect(sourceArtifactIsComplete('DISCOVER',[])).toBe(false)
  })
})

describe('server-captured source execution snapshot',()=>{
 it('runs the persisted verified profile rather than a later live profile edit',async()=>{
  const config={name:'Frozen profile',transport:'HTTP',allowedHosts:['example.org'],feeds:[{url:'https://example.org/old-feed',title:'Old',row:'article',link:'a'}],auth:{mode:'NONE'},maxPages:2,maxDocuments:10,delayMs:750}
  const prisma=db();const executors=createSourceOperationExecutors({prisma:prisma as unknown as PrismaClient,objectStore:{putRunFile:vi.fn()}})
  await executors.DISCOVER!({operation:'DISCOVER',mode:'FORCE',documentVersionIds:[],sourceId:'source',date:'2026-10-11',profileVersion:2,executionSnapshot:{source:{id:'source',key:'test-source',baseUrl:'https://example.org/',authorityType:'SUPPORTING'},profile:{id:'old-profile',version:2,config}}},context())
  expect(mocks.profile).not.toHaveBeenCalled();expect(mocks.collect).toHaveBeenCalledWith(expect.objectContaining({name:'Frozen profile',feeds:[expect.objectContaining({url:'https://example.org/old-feed'})]}),'2026-10-11',expect.anything(),null,'PUBLISHED_DATE')
 })
})
