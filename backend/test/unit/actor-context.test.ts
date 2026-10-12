import {describe,it,expect,vi} from 'vitest'
import type {PrismaClient} from '@prisma/client'
import {runWithActorContext,getActorContext,privateActorScope,sharedActorScope,documentAccessWhere,privateResourceWhere,chatAccessWhere,canonicalDocumentKey,permissionsForRole,resolveActorContext,type ActorContext} from '../../src/platform/actor-context'
import {OperationService} from '../../src/modules/operations/operation-service'
import {PrismaChatRepository} from '../../src/modules/chat/infrastructure/prisma-chat-repository'
const actor=(userId:string,role:ActorContext['role']='EDITOR'):ActorContext=>({userId,identityId:`identity-${userId}`,workspaceId:'atez',role,permissions:permissionsForRole(role),issuer:'https://issuer.invalid',subject:`sub-${userId}`})
describe('request actor and private resource boundaries',()=>{
 it('isolates overlapping async requests without singleton scope mutation',async()=>{
  const service=new OperationService({} as PrismaClient)
  const outputs=await Promise.all(['a','b'].map(userId=>runWithActorContext(actor(userId),async()=>{await Promise.resolve();return {actor:getActorContext()!.userId,scope:service.scope}})))
  expect(outputs).toEqual([{actor:'a',scope:'workspace:atez:user:a'},{actor:'b',scope:'workspace:atez:user:b'}]);expect(getActorContext()).toBeUndefined();expect(service.scope).toBe('local-workspace')
 })
 it('permits own private and explicitly shared workspace docs; admin is not a privacy bypass',()=>{
  runWithActorContext(actor('admin','ADMIN'),()=>{
   expect(documentAccessWhere()).toEqual({workspaceId:'atez',OR:[{visibility:'PRIVATE',ownerUserId:'admin'},{visibility:'WORKSPACE',actorScope:'workspace:atez:shared'}]})
   expect(privateResourceWhere()).toEqual({workspaceId:'atez',ownerUserId:'admin',visibility:'PRIVATE'})
   expect(chatAccessWhere()).toEqual({workspaceId:'atez',ownerId:'admin',visibility:'PRIVATE'})
   expect(canonicalDocumentKey('https://example.org/a',privateActorScope())).not.toBe(canonicalDocumentKey('https://example.org/a',sharedActorScope()))
  })
 })
 it('scopes chat UUID reads and creation ownership at the repository',async()=>{
  const count=vi.fn(async()=>0),create=vi.fn(async({data}:any)=>({...data,id:'chat',createdAt:new Date(),updatedAt:new Date(),title:null}))
  const repository=new PrismaChatRepository({chatSession:{count,create}} as unknown as PrismaClient)
  await runWithActorContext(actor('alice'),async()=>{expect(await repository.sessionExists('bobs-chat')).toBe(false);await repository.createSession()})
  expect(count).toHaveBeenCalledWith({where:{id:'bobs-chat',workspaceId:'atez',ownerId:'alice',visibility:'PRIVATE'}})
  expect(create).toHaveBeenCalledWith({data:{workspaceId:'atez',ownerId:'alice',visibility:'PRIVATE'}})
 })
 it('identity requires active application membership and the configured ATEZ workspace',async()=>{
  const identity={issuer:'https://issuer.invalid',subject:'sub'},membership={role:'VIEWER',permissions:[]}
  const prisma={externalIdentity:{findFirst:vi.fn(async()=>identity)},workspaceMembership:{findFirst:vi.fn(async()=>membership)}} as unknown as PrismaClient
  expect(await resolveActorContext(prisma,{userId:'u',identityId:'i',workspaceId:'w'})).toMatchObject({role:'VIEWER',issuer:identity.issuer})
  expect(prisma.workspaceMembership.findFirst).toHaveBeenCalledWith({where:{workspaceId:'w',userId:'u',active:true,workspace:{key:'atez'}}})
  ;(prisma.workspaceMembership.findFirst as any).mockResolvedValue(null)
  expect(await resolveActorContext(prisma,{userId:'u',identityId:'i',workspaceId:'w'})).toBeNull()
  expect(permissionsForRole('VIEWER',['document.upload','admin.manage','delivery.send'])).not.toContain('document.upload');expect(permissionsForRole('VIEWER',['admin.manage'])).not.toContain('admin.manage');expect(permissionsForRole('EDITOR',['admin.manage'])).not.toContain('admin.manage');expect(permissionsForRole('EDITOR')).not.toContain('delivery.send')
 })
})
