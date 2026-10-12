import { afterEach,describe,expect,it,vi } from 'vitest'
import Fastify from 'fastify'
import { isLocalWorkspaceRequest } from '../../src/platform/local-workspace-access'
import { operationsRoutes } from '../../src/modules/operations/operations.routes'
import { automationOperationRoutes } from '../../src/modules/operations/automation-operations.routes'
import { standaloneReportRoutes } from '../../src/modules/operations/standalone-reports'
import { chatRoutes, type ChatRouteOptions } from '../../src/modules/chat/chat.routes'
import type { OperationService } from '../../src/modules/operations/operation-service'
import type { StandaloneReportsService } from '../../src/modules/operations/standalone-reports'
const apps:ReturnType<typeof Fastify>[]=[]
afterEach(async()=>{await Promise.all(apps.map(app=>app.close()));apps.length=0})
describe('temporary local workspace access boundary',()=>{
  it('requires loopback peer and host, including IPv6, with a local browser origin',()=>{
    expect(isLocalWorkspaceRequest({ip:'127.0.0.1',headers:{host:'localhost:3001',origin:'http://localhost:5173'}})).toBe(true)
    expect(isLocalWorkspaceRequest({ip:'::1',headers:{host:'[::1]:3001',origin:'http://[::1]:5173'}})).toBe(true)
    for(const request of [
      {ip:'192.168.1.2',headers:{host:'localhost:3001'}},
      {ip:'127.0.0.1',headers:{host:'attacker.example:3001'}},
      {ip:'127.0.0.1',headers:{host:'localhost:3001',origin:'https://attacker.example'}},
      {ip:'127.0.0.1',headers:{host:'localhost.attacker.example'}},
      {ip:'127.0.0.1',headers:{host:'localhost',origin:'null'}},
    ])expect(isLocalWorkspaceRequest(request)).toBe(false)
  })
  it('blocks modular operation, publication and automation before service access',async()=>{
    const app=Fastify();apps.push(app)
    const plan=vi.fn(),get=vi.fn(),list=vi.fn(),publish=vi.fn(),lookup=vi.fn()
    await app.register(operationsRoutes,{prefix:'/api/v1',service:{plan,get} as unknown as OperationService})
    await app.register(standaloneReportRoutes,{prefix:'/api/v1',service:{list,publish} as unknown as StandaloneReportsService})
    await app.register(automationOperationRoutes,{prefix:'/api/v1',service:{prisma:{workspaceAutomation:{findUnique:lookup}}} as unknown as OperationService})
    for(const target of [
      {method:'POST' as const,url:'/api/v1/operations/plan'},
      {method:'GET' as const,url:'/api/v1/operations/private'},
      {method:'GET' as const,url:'/api/v1/standalone-reports'},
      {method:'POST' as const,url:'/api/v1/operation-tasks/private/publish'},
      {method:'POST' as const,url:'/api/v1/automations/private/operations'},
    ]){
      expect((await app.inject({...target,remoteAddress:'192.168.1.2'})).statusCode).toBe(401)
      expect((await app.inject({...target,headers:{origin:'https://attacker.example'}})).statusCode).toBe(401)
    }
    for(const spy of [plan,get,list,publish,lookup])expect(spy).not.toHaveBeenCalled()
  })
  it('protects chat tools and history only when modular operations are enabled',async()=>{
    const history=vi.fn(async()=>[])
    const options={repository:{listHistory:history},operations:{},knowledge:{},model:{},scanStarter:{},modelName:'fake'} as unknown as ChatRouteOptions
    const enabled=Fastify();apps.push(enabled);await enabled.register(chatRoutes,options)
    expect((await enabled.inject({method:'GET',url:'/sessions',headers:{origin:'https://missing-external-origin.invalid'}})).statusCode).toBe(401)
    expect((await enabled.inject({method:'GET',url:'/sessions',remoteAddress:'192.168.1.2'})).statusCode).toBe(401)
    expect(history).not.toHaveBeenCalled()
    const legacy=Fastify();apps.push(legacy);await legacy.register(chatRoutes,{...options,operations:undefined})
    expect((await legacy.inject({method:'GET',url:'/sessions',remoteAddress:'192.168.1.2'})).statusCode).toBe(200)
    expect(history).toHaveBeenCalledOnce()
  })
  it('preserves localhost inject and direct local API use',async()=>{
    const app=Fastify();apps.push(app);const plan=vi.fn(async()=>({canStart:false,missing:[]}))
    await app.register(operationsRoutes,{service:{plan} as unknown as OperationService})
    expect((await app.inject({method:'POST',url:'/operations/plan',payload:{operation:'EXTRACT'}})).statusCode).toBe(200)
    expect(plan).toHaveBeenCalledOnce()
  })
})
