import {describe,it,expect,vi} from 'vitest'
import type {PrismaClient} from '@prisma/client'
import {archiveClassifications} from '../../src/modules/documents/application/archive-classification'
describe('archive scope decisions',()=>{
 it('matches immutable bytes and never infers IN from a URL alone',async()=>{
  const prisma={documentLink:{findMany:vi.fn(async()=>[{documentVersionId:'v',scanRunId:'run'}])},collectedDocument:{findMany:vi.fn(async()=>[
   {sourceUrl:'https://example.org/a',storedObjectId:'old-bytes',edition:{scanRunId:'run'},filterDecisions:[{finalDecision:'IN',updatedAt:new Date()}]},
   {sourceUrl:'https://example.org/a',storedObjectId:'bytes',edition:{scanRunId:'run'},filterDecisions:[{finalDecision:'OUT',updatedAt:new Date()}]}
  ])},operationArtifact:{findMany:vi.fn(async()=>[])}}
  const result=await archiveClassifications(prisma as unknown as PrismaClient,[{id:'d',canonicalUrl:'https://example.org/a',versions:[{id:'v',storedObjectId:'bytes',contentHash:'hash'}]},{id:'unknown',canonicalUrl:'https://example.org/a',versions:[{id:'v2',storedObjectId:'other',contentHash:'other'}]}],'scope')
  expect(result.get('d')?.decision).toBe('OUT');expect(result.has('unknown')).toBe(false)
  expect(prisma.documentLink.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({actorScope:'scope'})}))
 })
 it('uses the newest explicit decision for the exact version',async()=>{
  const prisma={documentLink:{findMany:vi.fn(async()=>[])},operationArtifact:{findMany:vi.fn(async()=>[
   {createdAt:new Date('2026-10-13'),data:{decisions:[{documentVersionId:'v',decision:'OUT'}]}},
   {createdAt:new Date('2026-10-12'),data:{decisions:[{documentVersionId:'v',decision:'IN'}]}}
  ])}}
  expect((await archiveClassifications(prisma as unknown as PrismaClient,[{id:'d',canonicalUrl:null,versions:[{id:'v',storedObjectId:null,contentHash:'h'}]}],'scope')).get('d')?.decision).toBe('OUT')
 })
})
