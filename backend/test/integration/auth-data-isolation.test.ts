import {afterAll,beforeAll,describe,expect,it} from 'vitest'
import {randomUUID} from 'node:crypto'
import {PrismaClient} from '@prisma/client'
import {permissionsForRole,runWithActorContext,type ActorContext} from '../../src/platform/actor-context'
import {importDocument} from '../../src/modules/documents/application/import-document'
import {readableDocumentVersions} from '../../src/modules/documents/application/extract-document'
import {PrismaChatRepository} from '../../src/modules/chat/infrastructure/prisma-chat-repository'
import {OperationService} from '../../src/modules/operations/operation-service'
const suite=process.env.TEST_DATABASE_URL?describe:describe.skip
suite('authenticated private data and logical URL isolation',()=>{
 const prisma=new PrismaClient(),suffix=randomUUID(),userIds=[randomUUID(),randomUUID(),randomUUID()]
 const blobs=new Map<string,Buffer>(),store={getContent:async(key:string)=>blobs.get(key)!,putRunFile:async(key:string,bytes:Buffer,mediaType:string)=>{blobs.set(key,bytes);return {bucket:`test-${suffix}`,objectKey:key,byteSize:BigInt(bytes.length),mediaType,sha256:'fake'}}}
 let workspaceId:string
 const actor=(index:number):ActorContext=>({userId:userIds[index]!,identityId:`test-${index}`,workspaceId,role:index===2?'ADMIN':'EDITOR',permissions:permissionsForRole(index===2?'ADMIN':'EDITOR'),issuer:'https://test.invalid',subject:`test-${index}`})
 beforeAll(async()=>{
  const workspace=await prisma.workspace.upsert({where:{key:'atez'},create:{key:'atez',name:'Test ATEZ'},update:{}});workspaceId=workspace.id
  for(const [index,id] of userIds.entries())await prisma.user.create({data:{id,email:`auth-data-${suffix}-${index}@example.invalid`}})
 })
 afterAll(async()=>{
  const documents=await prisma.document.findMany({where:{ownerUserId:{in:userIds}},include:{versions:true}}),documentIds=documents.map(d=>d.id),versionIds=documents.flatMap(d=>d.versions.map(v=>v.id)),storedIds=documents.flatMap(d=>d.versions.flatMap(v=>v.storedObjectId?[v.storedObjectId]:[]))
  const requests=await prisma.operationRequest.findMany({where:{ownerUserId:{in:userIds}},include:{tasks:true}}),requestIds=requests.map(r=>r.id),taskIds=requests.flatMap(r=>r.tasks.map(t=>t.id))
  await prisma.operationArtifact.deleteMany({where:{taskId:{in:taskIds}}});await prisma.operationOutbox.deleteMany({where:{taskId:{in:taskIds}}});await prisma.operationAttempt.deleteMany({where:{taskId:{in:taskIds}}});await prisma.operationTask.deleteMany({where:{id:{in:taskIds}}});await prisma.operationRequest.deleteMany({where:{id:{in:requestIds}}})
  await prisma.documentLink.deleteMany({where:{ownerUserId:{in:userIds}}});await prisma.chatSession.deleteMany({where:{ownerId:{in:userIds}}});await prisma.documentImport.deleteMany({where:{ownerUserId:{in:userIds}}});await prisma.documentVersion.deleteMany({where:{id:{in:versionIds}}});await prisma.document.deleteMany({where:{id:{in:documentIds}}});await prisma.storedObject.deleteMany({where:{id:{in:storedIds}}});await prisma.user.deleteMany({where:{id:{in:userIds}}});await prisma.$disconnect()
 })
 it('identical URL bytes produce separate private logical records and no cross-user content access',async()=>{
  const input={bytes:Buffer.from(`Isolated evidence ${suffix}`),filename:'test.txt',canonicalUrl:`https://example.invalid/${suffix}`,actorScope:'ignored-user-scope'}
  const alice=await runWithActorContext(actor(0),()=>importDocument({prisma,objectStore:store},input))
  const bob=await runWithActorContext(actor(1),()=>importDocument({prisma,objectStore:store},input))
  expect(alice.document.id).not.toBe(bob.document.id)
  const rows=await prisma.documentVersion.findMany({where:{id:{in:[alice.version.id,bob.version.id]}}});expect(rows[0]!.storedObjectId).toBe(rows[1]!.storedObjectId)
  await expect(runWithActorContext(actor(1),()=>readableDocumentVersions(prisma,[alice.version.id]))).rejects.toMatchObject({statusCode:404})
  await expect(runWithActorContext(actor(2),()=>readableDocumentVersions(prisma,[alice.version.id]))).rejects.toMatchObject({statusCode:404})
  expect(await runWithActorContext(actor(0),()=>readableDocumentVersions(prisma,[alice.version.id]))).toHaveLength(1)
 })
 it('history and operation IDs stay private with independent idempotency namespaces',async()=>{
  const repository=new PrismaChatRepository(prisma),service=new OperationService(prisma)
  const chat=await runWithActorContext(actor(0),()=>repository.createSession())
  const research={sources:[{title:'Gazete',url:'https://www.resmigazete.gov.tr'}],citations:[],queries:['gümrük'],searchSuggestions:'<div>Google</div>'}
  await runWithActorContext(actor(0),()=>repository.appendMessage({sessionId:chat.id,role:'ASSISTANT',content:'Kaynaklı yanıt',status:'COMPLETED',research}))
  expect((await runWithActorContext(actor(0),()=>repository.getMessages(chat.id)))[0]?.research).toEqual(research)
  expect(await runWithActorContext(actor(1),()=>repository.getMessages(chat.id))).toEqual([])
  expect(await runWithActorContext(actor(2),()=>repository.getMessages(chat.id))).toEqual([])
  expect(await runWithActorContext(actor(1),()=>repository.sessionExists(chat.id))).toBe(false)
  expect((await runWithActorContext(actor(1),()=>repository.listHistory())).some(row=>row.id===chat.id)).toBe(false)
  const docs=await prisma.document.findMany({where:{ownerUserId:{in:userIds.slice(0,2)}},include:{versions:true}})
  const requests:Array<{id:string}>=[]
  for(let index=0;index<2;index++){const doc=docs.find(d=>d.ownerUserId===userIds[index])!;requests.push(await runWithActorContext(actor(index),()=>service.start({operation:'EXTRACT',mode:'REUSE_ONLY',documentVersionIds:[doc.versions[0]!.id]},'same-client-key')))}
  expect(requests[0]!.id).not.toBe(requests[1]!.id)
  await expect(runWithActorContext(actor(1),()=>service.get(requests[0]!.id))).rejects.toMatchObject({statusCode:404})
 })
})
