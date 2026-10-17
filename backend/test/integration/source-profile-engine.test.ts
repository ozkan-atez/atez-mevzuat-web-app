import {randomUUID,createHash} from 'node:crypto'
import {PrismaClient} from '@prisma/client'
import {afterEach,describe,it,expect,vi} from 'vitest'
import Fastify from 'fastify'
import {sourceScanRunRoutes} from '../../src/modules/managed-sources/source-scan-runs.routes'
const network=vi.hoisted(()=>({html:'',text:'İthalat usulü',urls:[] as string[]}))
vi.mock('../../src/modules/managed-sources/source-session',()=>({openSourceSession:async()=>({html:async(url:string)=>{network.urls.push(url);return network.html},binary:async(url:string)=>({body:Buffer.from(`<html><body>${network.text}</body></html>`),contentType:'text/html',finalUrl:url}),close:async()=>{}})}))
vi.mock('../../src/modules/managed-sources/process-source-documents',()=>({processSourceDocuments:async(prisma:PrismaClient,id:string)=>{await prisma.sourceScanDocument.updateMany({where:{runId:id},data:{processingStatus:'EXCLUDED',filterDecision:'OUT'}});return {failures:[],readyReports:0}}}))
import {executeSourceRun} from '../../src/modules/managed-sources/source-scan-run'
const prisma=new PrismaClient();const sourceIds:string[]=[];const parents:string[]=[]
const profile={name:'Fixture',transport:'HTTP',allowedHosts:['example.test'],feeds:[{url:'https://example.test/news',title:'Haberler',row:'article',link:'a',date:'time'}],auth:{mode:'NONE'},maxPages:2,maxDocuments:10,delayMs:300}
const processing:any={objectStore:{putRunFile:async(key:string,bytes:Buffer)=>({bucket:'test',objectKey:key,sha256:createHash('sha256').update(bytes).digest('hex')})},maxRunBytes:1000000n}
async function source(){const s=await prisma.source.create({data:{key:`profile-test-${randomUUID()}`,name:'Fixture',authorityType:'OFFICIAL',baseUrl:'https://example.test/'}});sourceIds.push(s.id);await prisma.sourceProfile.create({data:{sourceId:s.id,version:1,status:'VERIFIED',config:profile}});return s}
async function run(sourceId:string,policy='NEW_OR_CHANGED'){return prisma.sourceScanRun.create({data:{sourceId,trigger:'MANUAL',requestKey:randomUUID(),targetDate:new Date('2026-10-11'),datePolicy:policy}})}
afterEach(async()=>{await prisma.sourceScanRun.deleteMany({where:{sourceId:{in:sourceIds}}});await prisma.documentVersion.deleteMany({where:{document:{sourceId:{in:sourceIds}}}});await prisma.document.deleteMany({where:{sourceId:{in:sourceIds}}});await prisma.source.deleteMany({where:{id:{in:sourceIds}}});await prisma.scanRun.deleteMany({where:{id:{in:parents}}});sourceIds.length=0;parents.length=0;network.urls=[]})
describe('profile ingestion persistence',()=>{
 it('retains undated inventory but selects only the requested publication day',async()=>{
  const s=await source();network.html='<article><a href="/dated">Dated</a><time>11.10.2026</time></article><article><a href="/unknown">Unknown</a></article>';const r=await run(s.id,'PUBLISHED_DATE');await executeSourceRun(prisma,r.id,null,undefined,processing)
  expect(await prisma.sourceObservation.count({where:{sourceId:s.id,scope:'inventory'}})).toBe(2)
  const docs=await prisma.sourceScanDocument.findMany({where:{runId:r.id}});expect(docs).toHaveLength(1);expect(docs[0]?.publishedOn?.toISOString().slice(0,10)).toBe('2026-10-11')
  expect((await prisma.sourceScanRun.findUniqueOrThrow({where:{id:r.id}})).status).toBe('COMPLETED')
 })
 it('processes undated content once and reprocesses a changed body',async()=>{
  const s=await source();network.html='<article><a href="/unknown">Unknown</a></article>';network.text='İlk içerik';const first=await run(s.id);await executeSourceRun(prisma,first.id,null,undefined,processing)
  expect((await prisma.sourceScanDocument.findFirstOrThrow({where:{runId:first.id}})).dateBasis).toBe('FIRST_SEEN')
  const unchanged=await run(s.id);await executeSourceRun(prisma,unchanged.id,null,undefined,processing);expect(await prisma.sourceScanDocument.count({where:{runId:unchanged.id}})).toBe(0)
  network.text='Değişen içerik';const changed=await run(s.id);await executeSourceRun(prisma,changed.id,null,undefined,processing);expect(await prisma.sourceScanDocument.count({where:{runId:changed.id}})).toBe(1)
 })
 it('pins a profile snapshot across retries',async()=>{
  const s=await source();network.html='<article><a href="/a">A</a><time>11.10.2026</time></article>';const r=await run(s.id);await executeSourceRun(prisma,r.id,null,undefined,processing)
  await prisma.sourceProfile.create({data:{sourceId:s.id,version:2,status:'VERIFIED',config:{...profile,feeds:[{...profile.feeds[0],url:'https://example.test/replacement'}]}}})
  await prisma.sourceScanRun.update({where:{id:r.id},data:{status:'QUEUED'}});await executeSourceRun(prisma,r.id,null,undefined,processing);expect(network.urls).toEqual(['https://example.test/news','https://example.test/news'])
 })
 it('retries a child through its parent outbox instead of leaving it undispatched',async()=>{
  const s=await source();const parent=await prisma.scanRun.create({data:{requestKey:randomUUID(),targetDate:new Date('2026-10-11'),sourceKeys:[s.key],status:'PARTIAL'}});parents.push(parent.id)
  const child=await prisma.sourceScanRun.create({data:{sourceId:s.id,scanRunId:parent.id,trigger:'MANUAL',requestKey:randomUUID(),targetDate:new Date('2026-10-11'),status:'PARTIAL'}})
  const app=Fastify();await app.register(sourceScanRunRoutes,{prisma,prefix:'/sources'})
  try{expect((await app.inject({method:'POST',url:`/sources/${child.id}/retry`})).statusCode).toBe(202);expect(await prisma.scanOutbox.count({where:{scanRunId:parent.id,commandType:'START_SCAN'}})).toBe(1);expect((await app.inject({method:'POST',url:`/sources/${child.id}/retry`})).statusCode).toBe(409)}finally{await app.close()}
 })
})
