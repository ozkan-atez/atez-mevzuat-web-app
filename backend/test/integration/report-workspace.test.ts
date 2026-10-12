import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import type { StructuredAiRequest } from '../../src/modules/ai/application/ai-model-client'
import { ReportWorkspaceService } from '../../src/modules/report-workspace/report-workspace.service'
import { permissionsForRole, runWithActorContext, type ActorContext } from '../../src/platform/actor-context'

const suite=process.env.TEST_DATABASE_URL?describe:describe.skip
suite('report team workspace revisions',()=>{
 const prisma=new PrismaClient(),suffix=randomUUID(),userIds=[randomUUID(),randomUUID()],reportIds:string[]=[],runIds:string[]=[],files=new Map<string,Buffer>()
 let workspaceId:string
 const actor=(i:number):ActorContext=>({userId:userIds[i]!,workspaceId,identityId:'test',issuer:'test',subject:'test',role:'EDITOR',permissions:permissionsForRole('EDITOR')})
 const store={getContent:async(key:string)=>{const file=files.get(key);if(!file)throw new Error('Missing file');return file},putRunFile:async(key:string,body:Buffer,mediaType:string)=>{files.set(key,body);return {objectKey:key,sha256:'a'.repeat(64),byteSize:BigInt(body.length),mediaType}}}
 const ai={generateStructured:vi.fn(async(_request:StructuredAiRequest)=>({json:{outcome:'EDITS',edits:[{path:'emptyDayText',value:'Önerilen yeni bilgi metni'}]},providerRequestId:'mock',usage:{inputTokens:120,outputTokens:30}}))}
 const service=new ReportWorkspaceService(prisma,store,ai,'mock')
 beforeAll(async()=>{const url=new URL(process.env.TEST_DATABASE_URL!);if(url.port!=='45432'||!url.pathname.endsWith('_test'))throw new Error('Isolated database required');workspaceId=(await prisma.workspace.upsert({where:{key:'atez'},create:{key:'atez',name:'Test'},update:{}})).id;for(const [i,id]of userIds.entries())await prisma.user.create({data:{id,email:`report-team-${suffix}-${i}@example.invalid`,name:i?'Ayşe':'Ali'}})})
 afterAll(async()=>{await prisma.aiUsageEvent.deleteMany({where:{reportId:{in:reportIds}}});await prisma.topicReport.deleteMany({where:{id:{in:reportIds}}});await prisma.scanRun.deleteMany({where:{id:{in:runIds}}});await prisma.chatSession.deleteMany({where:{ownerId:{in:userIds}}});await prisma.user.deleteMany({where:{id:{in:userIds}}});await prisma.$disconnect()})
 async function fixture(visibility='WORKSPACE'){
  const id=randomUUID(),spec={schemaVersion:1,templateFamily:'bulten-v2',reportId:'121026-00',topicId:null,card:'K6',documentTitle:'Değişiklik yok',issueNumber:'33390',displayDate:'12 Ekim 2026',emptyDayText:'Bugün değişiklik yok.',source:{label:'Resmî Gazete',url:'https://www.resmigazete.gov.tr'},blocks:['B1','B10']};reportIds.push(id);files.set(`${id}/spec`,Buffer.from(JSON.stringify(spec)));files.set(`${id}/html`,Buffer.from('Original'))
  await prisma.topicReport.create({data:{id,workspaceId,ownerUserId:visibility==='PRIVATE'?userIds[0]!:null,visibility,title:'Rapor',basename:'00-degisiklik-yok.html',card:'K6',latestVersion:1,revisions:{create:{version:1,status:'VALIDATED',card:'K6',specObjectKey:`${id}/spec`,htmlObjectKey:`${id}/html`}}}});return id
 }
 it('shares report conversations only through report access; actor snapshots and private isolation survive',async()=>{
  const shared=await fixture(),privateId=await fixture('PRIVATE')
  const conversation=await runWithActorContext(actor(0),()=>service.createConversation(shared,'Yönetici özeti'))
  expect(conversation.createdByName).toBe('Ali')
  expect((await runWithActorContext(actor(1),()=>service.conversations(shared))).conversations[0]!.id).toBe(conversation.id)
  expect((await runWithActorContext(actor(1),()=>service.list())).reports.some(r=>r.id===privateId)).toBe(false)
  for(const action of [()=>service.state(privateId),()=>service.createConversation(privateId,'İzinsiz'),()=>service.versions(privateId),()=>service.version(privateId,1),()=>service.compare(privateId,1,1)])await expect(runWithActorContext<Promise<unknown>>(actor(1),action)).rejects.toMatchObject({status:404})
  await expect(runWithActorContext(actor(1),()=>service.messages(privateId,conversation.id))).rejects.toMatchObject({status:404})
 })
 it('keeps proposals out of drafts until selected, logs usage, detects stale concurrent writes and publishes immutable versions',async()=>{
  const id=await fixture(),conversation=await runWithActorContext(actor(0),()=>service.createConversation(id,'Düzenleme')),key=randomUUID()
  const proposal=await runWithActorContext(actor(0),()=>service.propose(id,conversation.id,'Metni açıkla',key))
  await runWithActorContext(actor(0),()=>service.propose(id,conversation.id,'Metni açıkla',key))
  expect(ai.generateStructured).toHaveBeenCalledTimes(1)
  expect((await service.state(id)).draft).toBeNull()
  expect(await prisma.aiUsageEvent.findFirst({where:{reportId:id}})).toMatchObject({status:'COMPLETED',inputTokens:120,outputTokens:30})
  const before=await service.state(id)
  const applied=await runWithActorContext(actor(1),()=>service.apply(id,{expectedRevision:before.revision,messageId:proposal.id,paths:['emptyDayText'],requestKey:randomUUID()}))
  expect(applied.draft!.edits[0]).toMatchObject({actorId:userIds[1],actorName:'Ayşe',requestedBy:userIds[0],source:'AI',baseVersion:1})
  await expect(service.apply(id,{expectedRevision:before.revision,edits:[{path:'emptyDayText',value:'Stale'}],requestKey:randomUUID()})).rejects.toMatchObject({status:409})
  const publish=await runWithActorContext(actor(1),()=>service.publish(id,applied.revision))
  expect(publish.version).toBe(2)
  expect((await service.publish(id,applied.revision)).version).toBe(2)
  expect((await service.version(id,1)).spec.emptyDayText).toBe('Bugün değişiklik yok.')
  expect((await service.version(id,2)).spec.emptyDayText).toBe('Önerilen yeni bilgi metni')
  const saved=await prisma.reportRevision.findFirst({where:{reportId:id,version:2}});expect(saved).toMatchObject({createdBy:userIds[1],createdByName:'Ayşe',baseVersion:1})
  const latest=await service.state(id),restored=await runWithActorContext(actor(0),()=>service.restore(id,1,latest.revision))
  expect(restored.baseVersion).toBe(2);expect(restored.draft?.restoredFromVersion).toBe(1)
  expect((await service.publish(id,restored.revision)).version).toBe(3)
  expect((await service.version(id,2)).spec.emptyDayText).toBe('Önerilen yeni bilgi metni')
 })
 it('lets nonconflicting proposals apply but requires explicit choice for a changed field',async()=>{
  const id=await fixture(),conversation=await service.createConversation(id,'Çakışma'),proposal=await service.propose(id,conversation.id,'Metin',randomUUID()),state=await service.state(id)
  const changed=await service.apply(id,{expectedRevision:state.revision,edits:[{path:'emptyDayText',value:'Elle düzeltilmiş metin'}],requestKey:randomUUID()})
  await expect(service.apply(id,{expectedRevision:changed.revision,messageId:proposal.id,paths:['emptyDayText'],requestKey:randomUUID()})).rejects.toMatchObject({status:409,details:{category:'FIELD_CONFLICT'}})
  const resolved=await service.apply(id,{expectedRevision:changed.revision,messageId:proposal.id,paths:['emptyDayText'],forcePaths:['emptyDayText'],requestKey:randomUUID()});expect((resolved.spec as {emptyDayText:string}).emptyDayText).toBe('Önerilen yeni bilgi metni')
 })
 it('serializes concurrent edits and rejects stale publication at the same base version',async()=>{
  const id=await fixture(),state=await service.state(id)
  const results=await Promise.allSettled(['Birinci','İkinci'].map(value=>service.apply(id,{expectedRevision:state.revision,edits:[{path:'emptyDayText',value}],requestKey:randomUUID()})))
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1)
  const current=await service.state(id);await service.apply(id,{expectedRevision:current.revision,edits:[{path:'emptyDayText',value:'Yeni taslak'}],requestKey:randomUUID()})
  await expect(service.publish(id,current.revision)).rejects.toMatchObject({status:409});expect((await service.report(id)).latestVersion).toBe(1)
 })
 it('deduplicates concurrent sends and uses only this conversation for follow-up context',async()=>{
  const id=await fixture(),conversation=await service.createConversation(id,'Takip konuşması'),other=await service.createConversation(id,'Ayrı sohbet')
  await prisma.reportConversationMessage.create({data:{conversationId:other.id,role:'USER',content:'Başka sohbetin özel bağlamı'}})
  const key=randomUUID(),before=ai.generateStructured.mock.calls.length
  await Promise.all([service.propose(id,conversation.id,'İlk açıklama',key),service.propose(id,conversation.id,'İlk açıklama',key)])
  expect(ai.generateStructured.mock.calls.length-before).toBe(1)
  await service.propose(id,conversation.id,'Bunu biraz daha kısalt',randomUUID())
  const request=ai.generateStructured.mock.calls.at(-1)![0]
  const context=JSON.stringify(request.parts)
  expect(context).toContain('İlk açıklama');expect(context).toContain('Önerilen yeni bilgi metni');expect(context).not.toContain('Başka sohbetin özel bağlamı')
 })

 it('backfills immutable legacy history with exact message IDs and preserves report and general-chat privacy',async()=>{
  const run=await prisma.scanRun.create({data:{requestKey:randomUUID(),targetDate:new Date('2026-10-12'),editions:{create:{publicationDate:new Date('2026-10-12'),type:'MAIN',indexUrl:`https://example.invalid/${randomUUID()}`,discoveryOrder:0,documents:{create:[{title:'Bir',sourceUrl:'https://example.invalid/one',publicationOrder:1},{title:'İki',sourceUrl:'https://example.invalid/two',publicationOrder:2}]}}}},include:{editions:{include:{documents:true}}}});runIds.push(run.id)
  const reports=[await fixture(),await fixture('PRIVATE')],threads=[]
  for(const [i,doc] of run.editions[0]!.documents.entries()){
   const topic=await prisma.topicProcess.create({data:{scanRunId:run.id,documentId:doc.id,thread:{create:{messages:{create:[{role:'USER',kind:'REVISION_REQUEST',content:'Önceki rapor isteği',initiatorUserId:userIds[0]!,workspaceId},{role:'ASSISTANT',kind:'REVISION_RESULT',content:'Önceki yanıt'}]}}}},include:{thread:{include:{messages:true}}}})
   await prisma.topicReport.update({where:{id:reports[i]!},data:{topicId:topic.id}});threads.push(topic.thread!)
  }
  const chat=await prisma.chatSession.create({data:{workspaceId,ownerId:userIds[0]!,visibility:'PRIVATE',messages:{create:{role:'USER',content:'Kişisel genel sohbet sırrı'}}},include:{messages:true}})
  const migration=readFileSync('prisma/migrations/20261012150000_chat_report_workflows/migration.sql','utf8'),backfill=migration.slice(migration.indexOf('-- Preserve legacy report threads'))
  for(let repeat=0;repeat<2;repeat++)for(const sql of backfill.split(';').map(s=>s.trim()).filter(Boolean))await prisma.$executeRawUnsafe(sql)
  const conversationId=`legacy:${threads[0]!.id}`
  const list=await runWithActorContext(actor(1),()=>service.conversations(reports[0]!));expect(list.conversations.some(c=>c.id===conversationId)).toBe(true)
  const messages=await runWithActorContext(actor(1),()=>service.messages(reports[0]!,conversationId))
  expect(messages.messages.map(m=>m.id).sort()).toEqual(threads[0]!.messages.map(m=>m.id).sort())
  expect(messages.messages.find(m=>m.role==='USER')).toMatchObject({authorId:userIds[0],authorName:'Ali'})
  expect(messages.messages.find(m=>m.role==='ASSISTANT')?.authorId).toBeNull()
  expect(await prisma.reportConversationMessage.findUnique({where:{id:chat.messages[0]!.id}})).toBeNull()
  await expect(runWithActorContext(actor(1),()=>service.messages(reports[1]!,`legacy:${threads[1]!.id}`))).rejects.toMatchObject({status:404})
  await expect(service.propose(reports[0]!,conversationId,'Eski geçmişi değiştir',randomUUID())).rejects.toMatchObject({status:409})
 })

})
