import Fastify from 'fastify'
import {describe,it,expect,vi} from 'vitest'
import {usageRoutes} from '../../src/modules/usage/usage.routes'
import {runWithActorContext,type ActorContext} from '../../src/platform/actor-context'
import type {PrismaClient} from '@prisma/client'
const actor:ActorContext={workspaceId:'workspace-a',userId:'user-a',identityId:'identity',role:'EDITOR',permissions:['workspace.read'],issuer:'test',subject:'user-a'}
function database(){return {aiUsageEvent:{aggregate:vi.fn().mockResolvedValue({_sum:{inputTokens:10,outputTokens:5,totalTokens:15},_count:1}),groupBy:vi.fn().mockResolvedValue([]),count:vi.fn().mockResolvedValue(1),findMany:vi.fn().mockResolvedValue([{id:'u',sessionId:'private-session',reportId:null,messageId:'secret-message',actorUserId:'other',totalTokens:15,status:'COMPLETED'}])},chatSession:{findMany:vi.fn().mockResolvedValue([])},topicReport:{findMany:vi.fn().mockResolvedValue([])},user:{findMany:vi.fn().mockResolvedValue([])}}}
describe('usage permissions',()=>{
 it('rejects team and other-actor filters without separate team permission',async()=>{
  const db=database(),app=Fastify();app.addHook('onRequest',(_req,_reply,done)=>runWithActorContext(actor,done));await app.register(usageRoutes,{prisma:db as unknown as PrismaClient})
  for(const query of ['team=true','actorId=other']){const response=await runWithActorContext(actor,()=>app.inject({url:`/api/v1/usage?${query}`}));expect(response.statusCode).toBe(403)}
  expect(db.aiUsageEvent.findMany).not.toHaveBeenCalled();await app.close()
 })
 it('scopes rows by workspace and actor and redacts inaccessible conversation references',async()=>{
  const db=database(),app=Fastify();app.addHook('onRequest',(_req,_reply,done)=>runWithActorContext(actor,done));await app.register(usageRoutes,{prisma:db as unknown as PrismaClient})
  const response=await runWithActorContext(actor,()=>app.inject({url:'/api/v1/usage'}))
  expect(response.statusCode).toBe(200)
  expect(db.aiUsageEvent.findMany.mock.calls[0]?.[0]).toMatchObject({where:{workspaceId:'workspace-a',actorUserId:'user-a'}})
  expect(response.json().events[0]).toMatchObject({title:'AI işlemi',sessionId:null,messageId:null,href:null})
  await app.close()
 })
})
