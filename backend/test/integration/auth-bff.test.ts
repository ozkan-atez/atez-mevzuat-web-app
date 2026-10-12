import Fastify from 'fastify'
import {PrismaClient} from '@prisma/client'
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest'
import {randomUUID} from 'node:crypto'
import {loadAuthConfig} from '../../src/modules/auth/config'
import {createAuthRuntime} from '../../src/modules/auth/runtime'
import {installAuth} from '../../src/modules/auth/guard'
import {authRoutes} from '../../src/modules/auth/auth.routes'
import {actorContext} from '../../src/platform/actor-context'
import type {AuthProvider,ProviderTokens} from '../../src/modules/auth/provider'
import {digest} from '../../src/modules/auth/security'
const enabled=Boolean(process.env.TEST_DATABASE_URL)
describe.skipIf(!enabled)('persistent BFF auth on isolated database',()=>{
 const prisma=new PrismaClient(),tag=randomUUID(),userIds:string[]=[],issuer=`http://localhost:45881/realms/auth-fixture-${tag}`
 const config=loadAuthConfig({AUTH_PROFILE:'local',APP_PUBLIC_ORIGIN:'http://localhost:5173',OIDC_ISSUER_URL:issuer,OIDC_CLIENT_ID:'fixture-client',OIDC_CLIENT_SECRET:'fixture-secret',OIDC_REDIRECT_URI:'http://localhost:5173/api/auth/callback',OIDC_POST_LOGOUT_REDIRECT_URI:'http://localhost:5173/login',SESSION_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64')})
 let workspaceId:string,subject=''
 const tokens=(sub=subject,issuedAt=Math.floor(Date.now()/1000)):ProviderTokens=>({subject:sub,sid:`sid:${sub}`,issuedAt,accessToken:'private-server-access',refreshToken:'private-server-refresh',idToken:'private-server-id',expiresAt:Date.now()+120_000})
 const provider:AuthProvider={authorizationUrl:vi.fn(async proof=>`${issuer}/authorize?state=${proof.state}&nonce=${proof.nonce}`),callback:vi.fn(async()=>tokens()),refresh:vi.fn(async old=>({...old,expiresAt:Date.now()+120_000,refreshToken:'rotated-private-refresh'})),logoutUrl:vi.fn(async()=>`${issuer}/logout?client_id=fixture-client`),revoke:vi.fn(async()=>undefined),verifyLogout:vi.fn(async token=>{if(token!=='signed-fixture')throw new Error('invalid signature');return{issuer,jti:randomUUID(),issuedAt:Math.floor(Date.now()/1000),subject,sid:`sid:${subject}`}})}
 let runtime:Awaited<ReturnType<typeof createAuthRuntime>>,app:ReturnType<typeof Fastify>
 const host={host:'localhost:5173'}
 beforeAll(async()=>{
  const url=new URL(process.env.TEST_DATABASE_URL!);if(url.port!=='45432'||!url.pathname.endsWith('_test'))throw new Error('Explicit isolated test database required.');await prisma.$connect()
  workspaceId=(await prisma.workspace.upsert({where:{key:'atez'},create:{key:'atez',name:'ATEZ test'},update:{}})).id
  runtime=await createAuthRuntime({prisma,config,provider});app=Fastify();await installAuth(app,{runtime});await app.register(authRoutes,{runtime,prefix:'/api/auth'})
  app.get('/api/health',async()=>({status:'ok'}));app.get('/api/v1/templates',async()=>({actor:actorContext.getStore()?.userId}));app.post('/api/v1/operations',async()=>({actor:actorContext.getStore()?.userId}));app.get('/api/v1/new-backdoor',async()=>({exposed:true}));app.post('/api/v1/topics/:id/dispatches',async()=>({sent:true}));await app.ready()
 })
 afterAll(async()=>{await app.close();await prisma.authSession.deleteMany({where:{issuer}});await prisma.authLoginAttempt.deleteMany({where:{issuer}});await prisma.logoutReplay.deleteMany({where:{issuer}});await prisma.workspaceMembership.deleteMany({where:{userId:{in:userIds}}});await prisma.externalIdentity.deleteMany({where:{issuer}});await prisma.user.deleteMany({where:{id:{in:userIds}}});await prisma.$disconnect()})
 const member=async(role='EDITOR',custom:string[]=[])=>{const sub=randomUUID(),user=await prisma.user.create({data:{email:`auth-${tag}-${sub}@example.test`,name:'Test üyesi',role}});userIds.push(user.id);await prisma.externalIdentity.create({data:{issuer,subject:sub,userId:user.id}});await prisma.workspaceMembership.create({data:{workspaceId,userId:user.id,role,permissions:custom}});return{sub,userId:user.id}}
 const sessionFor=async(role='EDITOR',custom:string[]=[])=>{const m=await member(role,custom);const session=await runtime.sessions.createSession(tokens(m.sub));return{...m,...session,cookie:`${config.sessionCookie}=${session.handle}`}}
 it('uses one-time code flow, rotates opaque cookie, and returns no provider tokens from /me',async()=>{
  const m=await member();subject=m.sub
  const login=await app.inject({method:'GET',url:'/api/auth/login?returnTo=%2Freports',headers:host});expect(login.statusCode).toBe(302)
  const loginCookie=String(login.headers['set-cookie']).split(';')[0]!,state=new URL(String(login.headers.location)).searchParams.get('state')!
  const callback=await app.inject({method:'GET',url:`/api/auth/callback?code=fixture-code&state=${state}`,headers:{...host,cookie:loginCookie}});expect(callback.statusCode).toBe(302);expect(callback.headers.location).toBe('http://localhost:5173/reports')
  const cookies=callback.headers['set-cookie'] as string[],sessionCookie=cookies.find(c=>c.startsWith(`${config.sessionCookie}=`))!.split(';')[0]!
  expect(cookies.join(';')).toContain('HttpOnly');expect(cookies.join(';')).not.toContain('private-server')
  const me=await app.inject({method:'GET',url:'/api/auth/me',headers:{...host,cookie:sessionCookie}});expect(me.statusCode).toBe(200);expect(me.json()).toMatchObject({user:{id:m.userId},role:'EDITOR',workspace:{id:workspaceId}});expect(me.body).not.toContain('private-server');expect(me.json().csrfToken).toHaveLength(43)
  const replay=await app.inject({method:'GET',url:`/api/auth/callback?code=fixture-code&state=${state}`,headers:{...host,cookie:loginCookie}});expect(replay.headers.location).toContain('/login?error=LOGIN_REPLAY');expect(provider.callback).toHaveBeenCalledTimes(1)
  const row=await prisma.authSession.findUniqueOrThrow({where:{idHash:digest(sessionCookie.split('=')[1]!)}});expect(row.encryptedTokens).not.toContain('private-server');expect(row.idHash).not.toBe(sessionCookie.split('=')[1])
 })
 it('rejects anonymous mock bearer and unconfigured business routes even for ADMIN',async()=>{
  expect((await app.inject({method:'GET',url:'/api/v1/templates',headers:{...host,authorization:'Bearer mock-token'}})).statusCode).toBe(401)
  const s=await sessionFor('ADMIN');expect((await app.inject({method:'GET',url:'/api/v1/new-backdoor',headers:{...host,cookie:s.cookie}})).statusCode).toBe(403)
 })
 it('enforces CSRF, canonical Origin and role demotion without stale custom grants',async()=>{
  const s=await sessionFor();const mutation=()=>app.inject({method:'POST',url:'/api/v1/operations',headers:{...host,cookie:s.cookie,origin:config.publicOrigin,'x-csrf-token':s.csrfToken},payload:{}})
  expect((await app.inject({method:'POST',url:'/api/v1/operations',headers:{...host,cookie:s.cookie},payload:{}})).statusCode).toBe(403)
  expect((await app.inject({method:'POST',url:'/api/v1/operations',headers:{...host,cookie:s.cookie,origin:'http://127.0.0.1:5173','x-csrf-token':s.csrfToken},payload:{}})).statusCode).toBe(403)
  expect((await mutation()).statusCode).toBe(200)
  await prisma.workspaceMembership.update({where:{workspaceId_userId:{workspaceId,userId:s.userId}},data:{role:'VIEWER',permissions:['analysis.run','admin.manage']}})
  expect((await mutation()).statusCode).toBe(403);expect((await app.inject({method:'GET',url:'/api/v1/templates',headers:{...host,cookie:s.cookie}})).statusCode).toBe(200)
 })
 it('rejects an unprovisioned issuer subject without merging by email',async()=>{await expect(runtime.sessions.createSession(tokens('unprovisioned'))).rejects.toMatchObject({statusCode:403});expect(await prisma.externalIdentity.findUnique({where:{issuer_subject:{issuer,subject:'unprovisioned'}}})).toBeNull()})
 it('keeps concurrent request actors isolated through AsyncLocalStorage',async()=>{
  const a=await sessionFor(),b=await sessionFor();const replies=await Promise.all([app.inject({method:'GET',url:'/api/v1/templates',headers:{...host,cookie:a.cookie}}),app.inject({method:'GET',url:'/api/v1/templates',headers:{...host,cookie:b.cookie}})]);expect(replies.map(r=>r.json().actor)).toEqual([a.userId,b.userId])
 })
 it('refreshes one token once across concurrent requests and persists session across runtime restart',async()=>{
  const s=await sessionFor();await prisma.authSession.update({where:{idHash:digest(s.handle)},data:{accessExpiresAt:new Date(0)}});const before=vi.mocked(provider.refresh).mock.calls.length
  const another=await createAuthRuntime({prisma,config,provider});const responses=await Promise.all([runtime.sessions.authenticate(s.handle),another.sessions.authenticate(s.handle)]);expect(responses.map(r=>r.actor.userId)).toEqual([s.userId,s.userId]);expect(vi.mocked(provider.refresh).mock.calls.length-before).toBe(1)
 })
 it('cannot resurrect a session when logout happens during refresh, and local logout succeeds while provider is down',async()=>{
  const s=await sessionFor();await prisma.authSession.update({where:{idHash:digest(s.handle)},data:{accessExpiresAt:new Date(0)}})
  let release!:(tokens:ProviderTokens)=>void;const entered=vi.fn();vi.mocked(provider.refresh).mockImplementationOnce(async()=>{entered();return new Promise(resolve=>{release=resolve})})
  const refresh=runtime.sessions.authenticate(s.handle).then(()=>null,error=>error);await vi.waitFor(()=>expect(entered).toHaveBeenCalledTimes(1));vi.mocked(provider.revoke).mockRejectedValueOnce(new Error('provider down'));await runtime.sessions.logout(s.handle);release(tokens(s.sub));expect(await refresh).toMatchObject({statusCode:401});expect((await prisma.authSession.findUniqueOrThrow({where:{idHash:digest(s.handle)}})).revoked).toBe(true)
 })
 it('validates backchannel proof without cookies and permanently rejects replay or late stale callbacks',async()=>{
  const s=await sessionFor();const issuedAt=Math.floor(Date.now()/1000),claims={issuer,jti:randomUUID(),issuedAt,subject:s.sub,sid:`sid:${s.sub}`}
  vi.mocked(provider.verifyLogout).mockResolvedValueOnce(claims).mockResolvedValueOnce(claims)
  expect((await app.inject({method:'POST',url:'/api/auth/backchannel-logout',headers:{...host,'content-type':'application/x-www-form-urlencoded'},payload:'logout_token=valid'})).statusCode).toBe(200)
  expect((await app.inject({method:'POST',url:'/api/auth/backchannel-logout',headers:{...host,'content-type':'application/x-www-form-urlencoded'},payload:'logout_token=valid'})).statusCode).toBe(400)
  await expect(runtime.sessions.authenticate(s.handle)).rejects.toMatchObject({statusCode:401});await expect(runtime.sessions.createSession(tokens(s.sub,issuedAt))).rejects.toMatchObject({statusCode:401})
  const fresh={...tokens(s.sub,issuedAt+1),sid:'fresh-provider-session'};expect((await runtime.sessions.createSession(fresh)).handle).toHaveLength(43)
 })
 it('rejects expired flow atomically without exchanging authorization code',async()=>{const login=await runtime.sessions.createLogin('/');const row=await prisma.authLoginAttempt.findUniqueOrThrow({where:{idHash:digest(login.handle)}});await prisma.authLoginAttempt.update({where:{idHash:row.idHash},data:{expiresAt:new Date(0)}});await expect(runtime.sessions.consumeLogin(login.handle,new URL(login.url).searchParams.get('state')!)).rejects.toMatchObject({statusCode:400})})
})
