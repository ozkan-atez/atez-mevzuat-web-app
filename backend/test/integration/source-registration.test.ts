import Fastify from 'fastify'
import {PrismaClient} from '@prisma/client'
import {afterAll,describe,it,expect,vi} from 'vitest'
import {sourceDiscoveryRoutes} from '../../src/modules/managed-sources/source-discovery.routes'
import {scanSupported} from '../../src/modules/workspace/catalog'
const fixture=vi.hoisted(()=>({pdf:false}))
vi.mock('../../src/modules/managed-sources/fetch-managed-source',async importOriginal=>({...(await importOriginal<object>()),fetchSourceLinks:async()=>[{url:'https://source-registration.example/feed',title:'Gümrük mevzuat duyuruları'}],fetchManagedSource:async()=>({contentText:'10.10.2026 İthalat duyurusu',contentType:fixture.pdf?'application/pdf':'text/html',fetchedAt:new Date()})}))
const prisma=new PrismaClient();const sourceIds:string[]=[]
afterAll(async()=>{const endpoints=await prisma.sourceEndpoint.findMany({where:{sourceId:{in:sourceIds}}});await prisma.source.deleteMany({where:{id:{in:sourceIds}}});await prisma.managedSource.deleteMany({where:{id:{in:endpoints.flatMap(e=>e.managedSourceId?[e.managedSourceId]:[])}}});await prisma.$disconnect()})
describe('new source registration',()=>{
 it('adds a site and requires a verified profile before a generic feed is runnable',async()=>{
  fixture.pdf=false;const app=Fastify();await app.register(sourceDiscoveryRoutes,{prefix:'/sites',prisma,model:{async *streamReply(){yield {type:'text',text:'{"indexes":[0]}'}}},modelName:'test'})
  try {
   const created=await app.inject({method:'POST',url:'/sites',payload:{title:'Generic test',url:'https://source-registration.example/'}})
   expect(created.statusCode).toBe(201);const id=created.json().id;sourceIds.push(id)
   expect((await app.inject({method:'POST',url:'/sites',payload:{title:'Duplicate',url:'https://source-registration.example/'}})).statusCode).toBe(409)
   const discovered=await app.inject({method:'POST',url:`/sites/${id}/discover`});const endpoint=discovered.json().endpoints[0]
   const active=await app.inject({method:'POST',url:`/sites/${id}/endpoints/${endpoint.id}/activate`})
   expect(active.statusCode).toBe(200);expect(active.json()).toMatchObject({status:'ACTIVE',adapter:'GENERIC'})
   expect(scanSupported((await prisma.source.findUniqueOrThrow({where:{id},include:{endpoints:true}})))).toBe(false)
   await prisma.sourceProfile.create({data:{sourceId:id,version:1,status:'VERIFIED',config:{}}})
   expect(scanSupported(await prisma.source.findUniqueOrThrow({where:{id},include:{endpoints:true,profiles:true}}))).toBe(true)
  }finally{await app.close()}
 })
 it('keeps a PDF reference from pretending to be a dated HTML feed',async()=>{
  fixture.pdf=true;const source=await prisma.source.create({data:{key:crypto.randomUUID(),name:'PDF test',baseUrl:'https://source-registration.example/pdf',authorityType:'REFERENCE',endpoints:{create:{url:'https://source-registration.example/file.pdf',title:'Mevzuat'}}},include:{endpoints:true}});sourceIds.push(source.id)
  const app=Fastify();await app.register(sourceDiscoveryRoutes,{prefix:'/sites',prisma,model:{async *streamReply(){}},modelName:'test'})
  try{const active=await app.inject({method:'POST',url:`/sites/${source.id}/endpoints/${source.endpoints[0]!.id}/activate`});expect(active.json()).toMatchObject({status:'ACTIVE',adapter:null})}finally{await app.close()}
 })
})
