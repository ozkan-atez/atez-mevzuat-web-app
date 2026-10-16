import Fastify from 'fastify'
import {it,expect,vi} from 'vitest'
import type {PrismaClient} from '@prisma/client'
import {workspaceRoutes} from '../../src/modules/workspace/workspace.routes'
import {rabbitQueue} from '../../src/platform/rabbitmq'
it('keeps history available without live service and filters before pagination',async()=>{
 const live=vi.spyOn(rabbitQueue,'status').mockRejectedValue(new Error('offline'))
 const findMany=vi.fn(async(args:any)=>args.distinct?[{queue:'atez-source-scan'}]:[{id:'done',status:'COMPLETED'}])
 const app=Fastify()
 try{
  await app.register(workspaceRoutes,{prisma:{backgroundJob:{findMany,count:vi.fn(async()=>16),groupBy:vi.fn(async()=>[{status:'COMPLETED',_count:{_all:16}}])}} as unknown as PrismaClient})
  const response=await app.inject('/api/v1/background-jobs?status=COMPLETED&page=2&queue=atez-source-scan')
  expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({connected:false,total:16,counts:{COMPLETED:16},jobs:[{id:'done'}]})
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({where:{status:'COMPLETED',queue:'atez-source-scan'},skip:15,take:15}))
  expect((await app.inject('/api/v1/background-jobs?page=0')).statusCode).toBe(400)
 }finally{await app.close();live.mockRestore()}
})
