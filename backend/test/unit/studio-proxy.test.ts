import {afterEach,describe,it,expect,vi} from 'vitest'
import Fastify from 'fastify'
import type {PrismaClient} from '@prisma/client'
import {studioProxyRoutes} from '../../src/modules/workspace/studio-proxy.routes'
import {requiredPermission} from '../../src/modules/auth/route-policy'
vi.mock('../../src/modules/workspace/studio-bridge',()=>({syncStudioTemplates:vi.fn()}))
afterEach(()=>vi.unstubAllGlobals())
describe('studio authenticated bridge',()=>{
 it('requires configuration permission on all methods',()=>{for(const method of ['GET','POST','PUT','PATCH','DELETE'])expect(requiredPermission(method,'/api/v2/*')).toBe('config.manage')})
 it('forwards studio bodies without forwarding browser credentials',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({ok:true}),{status:200}));vi.stubGlobal('fetch',fetch)
  const app=Fastify();await app.register(studioProxyRoutes,{baseUrl:'http://127.0.0.1:3101',prisma:{} as PrismaClient})
  const r=await app.inject({method:'POST',url:'/api/v2/components/ai/draft',headers:{cookie:'secret-session'},payload:{request:'Yeni kart'}})
  expect(r.statusCode).toBe(200);expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:3101/api/components/ai/draft',expect.objectContaining({body:JSON.stringify({request:'Yeni kart'}),headers:{'content-type':'application/json'}}));await app.close()
 })
 it('does not expose pipeline endpoints or upstream errors',async()=>{
  const fetch=vi.fn().mockRejectedValue(new Error('private server detail'));vi.stubGlobal('fetch',fetch)
  const app=Fastify();await app.register(studioProxyRoutes,{baseUrl:'http://127.0.0.1:3101',prisma:{} as PrismaClient})
  expect((await app.inject('/api/v2/runs')).statusCode).toBe(404);expect(fetch).not.toHaveBeenCalled()
  expect((await app.inject('/api/v2/components/%2e%2e/runs')).statusCode).toBe(404);expect(fetch).not.toHaveBeenCalled()
  const r=await app.inject('/api/v2/components');expect(r.statusCode).toBe(503);expect(r.body).not.toContain('private server');await app.close()
 })
})
