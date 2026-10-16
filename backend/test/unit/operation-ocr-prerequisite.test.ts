import {describe,it,expect,vi} from 'vitest'
import type {PrismaClient} from '@prisma/client'
import {OperationService} from '../../src/modules/operations/operation-service'
describe('OCR operation prerequisites',()=>{
 const service=()=>new OperationService({documentVersion:{findMany:vi.fn(async()=>[{id:'v',contentHash:'h',extractionStatus:'OCR_REQUIRED',extractedText:null,document:{}}])},operationTask:{findFirst:vi.fn(async()=>null)}} as unknown as PrismaClient,{executors:{EXTRACT:async()=>[],ANALYZE:async()=>[]}})
 it('queues extraction before analysis for an image',async()=>{
  const plan=await service().plan({operation:'ANALYZE',mode:'FILL_MISSING',documentVersionIds:['v']})
  expect(plan.canStart).toBe(true)
  expect(plan.tasks.map(t=>t.operation)).toEqual(['EXTRACT','ANALYZE'])
  expect(plan.tasks[1]?.signatureDependencies).toEqual([plan.tasks[0]?.inputSignature])
 })
 it('respects reuse-only mode',async()=>{
  const plan=await service().plan({operation:'ANALYZE',mode:'REUSE_ONLY',documentVersionIds:['v']})
  expect(plan.canStart).toBe(false)
  expect(plan.missing).toContainEqual({operation:'EXTRACT',documentVersionId:'v',reason:'OCR_REQUIRED'})
 })
})
