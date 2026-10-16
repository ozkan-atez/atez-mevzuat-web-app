import Fastify from 'fastify'
import { describe,it,expect,vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { workspaceRoutes } from '../../src/modules/workspace/workspace.routes'
import { templateAiRoutes } from '../../src/modules/workspace/template-ai.routes'
import { defaultTemplateDefinition } from '../../src/modules/workspace/template-definition'
import { defaultSections,templateHtml } from '../../src/modules/workspace/report-template-catalog'
import { requiredPermission } from '../../src/modules/auth/route-policy'
const definition=defaultTemplateDefinition()
const payload={name:'İçerik ve tasarım',definition,sections:defaultSections,html:templateHtml,isActive:true}
describe('template studio routes',()=>{
 it('persists requirements and design without canonicalizing user headings',async()=>{
  const create=vi.fn().mockImplementation(async({data})=>({id:'t1',revision:1,...data}))
  const app=Fastify();await app.register(workspaceRoutes,{prisma:{reportTemplate:{create}} as unknown as PrismaClient})
  const response=await app.inject({method:'POST',url:'/api/v1/templates',payload})
  expect(response.statusCode).toBe(201);expect(response.json().definition).toEqual(definition);await app.close()
 })
 it('atomically rejects stale saves and increments accepted revisions',async()=>{
  const findUniqueOrThrow=vi.fn().mockResolvedValue({...payload,id:'t1',revision:3}),updateMany=vi.fn().mockResolvedValue({count:0})
  const app=Fastify();await app.register(workspaceRoutes,{prisma:{reportTemplate:{findUniqueOrThrow,updateMany}} as unknown as PrismaClient})
  expect((await app.inject({method:'PATCH',url:'/api/v1/templates/t1',payload:{...payload,expectedRevision:2}})).statusCode).toBe(409)
  expect(updateMany.mock.calls[0]![0]).toMatchObject({where:{id:'t1',revision:2},data:{revision:{increment:1}}})
  updateMany.mockResolvedValue({count:1});expect((await app.inject({method:'PATCH',url:'/api/v1/templates/t1',payload:{name:'Yeni',expectedRevision:3}})).statusCode).toBe(200)
  expect(updateMany.mock.calls[1]![0].data).not.toHaveProperty('definition');await app.close()
 })
 it('renders a preview without a model or database and does not print instructions',async()=>{
  const app=Fastify();await app.register(templateAiRoutes,{prisma:{} as PrismaClient})
  const response=await app.inject({method:'POST',url:'/api/v1/templates/preview',payload:{definition,title:'Test'}})
  expect(response.statusCode).toBe(200);expect(response.json().html).toContain('Tasarım önizlemesi');expect(response.json().html).not.toContain(definition.requirements[0]!.instruction);await app.close()
 })
 it('renders isolated component HTML and rejects unknown component IDs',async()=>{
  const app=Fastify();await app.register(templateAiRoutes,{prisma:{} as PrismaClient})
  const response=await app.inject({method:'POST',url:'/api/v1/templates/preview',payload:{definition,componentIds:['table','notice']}})
  expect(response.statusCode).toBe(200)
  expect(Object.keys(response.json().components)).toEqual(['table','notice'])
  expect(response.json().components.table).toContain('<table');expect(response.json().components.notice).toContain('<aside')
  expect(response.json().components.table).not.toContain('Yönetici özeti');expect(response.json().components.table).toContain('Content-Security-Policy')
  expect((await app.inject({method:'POST',url:'/api/v1/templates/preview',payload:{definition,componentIds:['unknown']}})).statusCode).toBe(400)
  await app.close()
 })
 it('passes bounded component conversation context to the model',async()=>{
  const prisma={templateAiRequest:{findUnique:vi.fn(async()=>null),create:vi.fn(async()=>({id:'job'})),update:vi.fn(async()=>({}))}}
  const component={...definition.components[0]!,id:'new-component'}
  const aiModel={generateStructured:vi.fn().mockResolvedValue({json:component,usage:{inputTokens:1,outputTokens:2}})}
  const app=Fastify();await app.register(templateAiRoutes,{prisma:prisma as unknown as PrismaClient,aiModel})
  const conversation=[{role:'user',content:'Bir oran kartı yap'},{role:'assistant',content:JSON.stringify(component)}]
  const input={requestKey:'11111111-1111-4111-8111-111111111111',definition,mode:'COMPONENT',instruction:'Bir açıklama ekle',conversation}
  const response=await app.inject({method:'POST',url:'/api/v1/templates/ai',payload:input})
  expect(response.statusCode).toBe(200);expect(JSON.parse(aiModel.generateStructured.mock.calls[0]![0].parts[0].text).conversation).toEqual(conversation)
  expect(response.json().definition.layout).toEqual(definition.layout)
  expect((await app.inject({method:'POST',url:'/api/v1/templates/ai',payload:{...input,conversation:Array(13).fill(conversation[0])}})).statusCode).toBe(400)
  await app.close()
 })
 it('records an AI request and replays the stored result without another call',async()=>{
  let saved:any=null
  const prisma={templateAiRequest:{findUnique:vi.fn(async()=>saved),create:vi.fn(async({data})=>(saved={id:'job1',...data,status:'RUNNING'})),update:vi.fn(async({data})=>(saved={...saved,...data}))}}
  const aiModel={generateStructured:vi.fn().mockResolvedValue({json:definition,usage:{inputTokens:11,outputTokens:22},providerRequestId:'provider'})}
  const app=Fastify();await app.register(templateAiRoutes,{prisma:prisma as unknown as PrismaClient,aiModel,modelName:'test'})
  const input={requestKey:'11111111-1111-4111-8111-111111111111',definition,mode:'DESIGN',instruction:'Tasarımı koru'}
  expect((await app.inject({method:'POST',url:'/api/v1/templates/ai',payload:input})).statusCode).toBe(200)
  expect(saved.usage).toEqual({inputTokens:11,outputTokens:22});expect(saved.status).toBe('COMPLETED')
  expect((await app.inject({method:'POST',url:'/api/v1/templates/ai',payload:input})).statusCode).toBe(200);expect(aiModel.generateStructured).toHaveBeenCalledTimes(1)
  expect((await app.inject({method:'POST',url:'/api/v1/templates/ai',payload:{...input,instruction:'Başka istek'}})).statusCode).toBe(409);await app.close()
 })
 it('requires config permission for AI operations and permits read previews',()=>{
  expect(requiredPermission('POST','/api/v1/templates/ai')).toBe('config.manage');expect(requiredPermission('POST','/api/v1/templates/preview')).toBe('workspace.read')
 })
})
