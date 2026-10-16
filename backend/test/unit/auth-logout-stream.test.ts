import Fastify from 'fastify'
import {describe,it,expect,vi} from 'vitest'
import type {PrismaClient} from '@prisma/client'
import {AuthRuntime} from '../../src/modules/auth/runtime'
import {installAuth} from '../../src/modules/auth/guard'
import {authRoutes} from '../../src/modules/auth/auth.routes'
import {loadAuthConfig} from '../../src/modules/auth/config'
import {randomHandle,digest} from '../../src/modules/auth/security'
import type {AuthProvider} from '../../src/modules/auth/provider'
import {permissionsForRole,actorContext,type ActorContext} from '../../src/platform/actor-context'
const config=loadAuthConfig({AUTH_PROFILE:'local',APP_PUBLIC_ORIGIN:'http://localhost:5173',OIDC_ISSUER_URL:'http://localhost:45881/realms/test',OIDC_CLIENT_ID:'client',OIDC_CLIENT_SECRET:'fixture-secret',OIDC_REDIRECT_URI:'http://localhost:5173/api/auth/callback',OIDC_POST_LOGOUT_REDIRECT_URI:'http://localhost:5173/login',SESSION_ENCRYPTION_KEY:Buffer.alloc(32,3).toString('hex')})
const actor=(role:'EDITOR'|'VIEWER'='EDITOR'):ActorContext=>({userId:'user',identityId:'identity',workspaceId:'workspace',issuer:config.issuer,subject:'subject',role,permissions:permissionsForRole(role)})
describe('logout and long-running request boundaries',()=>{
 it('allows admin context and new operations, still checks CSRF and current role',async()=>{
  const csrf=randomHandle(),runtime=new AuthRuntime({} as PrismaClient,config,{} as AuthProvider)
  let current:ActorContext={...actor(),role:'ADMIN',permissions:[]}
  vi.spyOn(runtime,'authenticate').mockImplementation(async()=>({actor:{...current},session:{csrfToken:csrf} as any,user:{id:'user',email:'u@test',name:null},workspace:{id:'workspace',name:'ATEZ'}}))
  const app=Fastify();await installAuth(app,{runtime})
  app.get('/api/v1/chat/context',async()=>({ok:true}))
  app.post('/api/v1/admin-new-operation',async request=>{await request.assertSessionActive!();return{ok:true}})
  app.get('/api/v1/admin-demotion',async request=>{current=actor('VIEWER');await request.assertSessionActive!();return{ok:true}})
  const headers={host:'localhost:5173',cookie:`${config.sessionCookie}=${randomHandle()}`,origin:config.publicOrigin,'x-csrf-token':csrf}
  try {
   expect((await app.inject({method:'GET',url:'/api/v1/chat/context',headers})).statusCode).toBe(200)
   expect((await app.inject({method:'POST',url:'/api/v1/admin-new-operation',headers})).statusCode).toBe(200)
   expect((await app.inject({method:'POST',url:'/api/v1/admin-new-operation',headers:{...headers,'x-csrf-token':'invalid'}})).statusCode).toBe(403)
   expect((await app.inject({method:'GET',url:'/api/v1/admin-demotion',headers})).statusCode).toBe(403)
   expect((await app.inject({method:'POST',url:'/api/v1/admin-new-operation',headers})).statusCode).toBe(403)
  } finally {await app.close()}
 })
 it('accepts a CSRF-proven expired revoked-member logout without refreshing or loading membership',async()=>{
  const handle=randomHandle(),csrf=randomHandle(),row={idHash:digest(handle),issuer:config.issuer,clientId:config.clientId,csrfToken:csrf,encryptedTokens:null,idleExpiresAt:new Date(0),absoluteExpiresAt:new Date(0),revoked:true}
  const prisma={authSession:{findUnique:vi.fn(async()=>row),updateMany:vi.fn(async()=>({count:0}))},externalIdentity:{findFirst:vi.fn()},workspaceMembership:{findFirst:vi.fn()}} as unknown as PrismaClient
  const provider={logoutUrl:vi.fn().mockRejectedValue(new Error('provider down')),revoke:vi.fn(),refresh:vi.fn()} as unknown as AuthProvider
  const runtime=new AuthRuntime(prisma,config,provider),app=Fastify();await installAuth(app,{runtime});await app.register(authRoutes,{runtime,prefix:'/api/auth'})
  try{const response=await app.inject({method:'POST',url:'/api/auth/logout',headers:{host:'localhost:5173',cookie:`${config.sessionCookie}=${handle}`,origin:config.publicOrigin,'x-csrf-token':csrf}});expect(response.statusCode).toBe(200);expect(response.json()).toEqual({logoutUrl:'http://localhost:5173/login'});expect(response.headers['set-cookie']).toBeTruthy();expect(provider.refresh).not.toHaveBeenCalled();expect(prisma.externalIdentity.findFirst).not.toHaveBeenCalled();expect(prisma.workspaceMembership.findFirst).not.toHaveBeenCalled()}finally{await app.close()}
 })
 it('never makes logout public or removes CSRF checks for expired sessions',async()=>{
  const handle=randomHandle(),prisma={authSession:{findUnique:vi.fn(async()=>({issuer:config.issuer,clientId:config.clientId,csrfToken:randomHandle()})),updateMany:vi.fn()}} as unknown as PrismaClient,provider={} as AuthProvider
  const app=Fastify();await installAuth(app,{runtime:new AuthRuntime(prisma,config,provider)});await app.register(authRoutes,{runtime:new AuthRuntime(prisma,config,provider),prefix:'/api/auth'})
  try{const noProof=await app.inject({method:'POST',url:'/api/auth/logout',headers:{host:'localhost:5173',cookie:`${config.sessionCookie}=${handle}`}});expect(noProof.statusCode).toBe(403);expect(prisma.authSession.updateMany).not.toHaveBeenCalled();expect((await app.inject({method:'POST',url:'/api/auth/logout',headers:{host:'localhost:5173'}})).statusCode).toBe(401)}finally{await app.close()}
 })
 it('rechecks stream permission using current membership without extending idle and stops a demoted editor',async()=>{
  const csrf=randomHandle(),runtime=new AuthRuntime({} as PrismaClient,config,{} as AuthProvider)
  const authenticate=vi.spyOn(runtime,'authenticate').mockResolvedValueOnce({actor:actor(),session:{csrfToken:csrf} as any,user:{id:'user',email:'u@test',name:null},workspace:{id:'workspace',name:'ATEZ'}}).mockResolvedValueOnce({actor:actor('VIEWER'),session:{csrfToken:csrf} as any,user:{id:'user',email:'u@test',name:null},workspace:{id:'workspace',name:'ATEZ'}})
  const app=Fastify();await installAuth(app,{runtime});app.post('/api/v1/chat/sessions/:id/messages',async request=>{await request.assertSessionActive!();return{unsafeContinuation:true}})
  try{const response=await app.inject({method:'POST',url:'/api/v1/chat/sessions/s/messages',headers:{host:'localhost:5173',cookie:`${config.sessionCookie}=${randomHandle()}`,origin:config.publicOrigin,'x-csrf-token':csrf},payload:{}});expect(response.statusCode).toBe(403);expect(authenticate.mock.calls[1]).toEqual([expect.any(String),false,{touch:false}]);expect(response.body).not.toContain('unsafeContinuation')}finally{await app.close()}
 })
 it('updates the stream actor permissions when membership changes within the same allowed route',async()=>{
  const runtime=new AuthRuntime({} as PrismaClient,config,{} as AuthProvider),admin={...actor(),role:'ADMIN' as const,permissions:permissionsForRole('ADMIN')},editor=actor()
  vi.spyOn(runtime,'authenticate').mockResolvedValueOnce({actor:admin,session:{} as any,user:{id:'user',email:'u@test',name:null},workspace:{id:'workspace',name:'ATEZ'}}).mockResolvedValueOnce({actor:editor,session:{} as any,user:{id:'user',email:'u@test',name:null},workspace:{id:'workspace',name:'ATEZ'}})
  const app=Fastify();await installAuth(app,{runtime});app.get('/api/v1/templates',async request=>{await request.assertSessionActive!();return{permissions:actorContext.getStore()?.permissions}})
  try{const response=await app.inject({method:'GET',url:'/api/v1/templates',headers:{host:'localhost:5173',cookie:`${config.sessionCookie}=${randomHandle()}`}});expect(response.statusCode).toBe(200);expect(response.json().permissions).not.toContain('delivery.send');expect(response.json().permissions).not.toContain('config.manage')}finally{await app.close()}
 })
})
