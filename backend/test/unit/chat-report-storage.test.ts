import {describe,it,expect,vi} from 'vitest'
import {PrismaChatReportCreator} from '../../src/modules/chat/infrastructure/prisma-chat-report-creator'
import {createOperationExecutors} from '../../src/modules/operations/executors'
import {runWithActorContext} from '../../src/platform/actor-context'
const input={sessionId:'s',messageId:'m',instruction:'Rapor oluştur',templateId:'t',warnings:[],evidence:[{id:'e',title:'Kaynak',url:null,text:'Kaynak metni',publishedOn:null}]}
describe('chat report storage gates',()=>{
 it('does not create a draft or publish when generated evidence is invented',async()=>{
  const task={update:vi.fn(),updateMany:vi.fn()}
  const request={findUnique:vi.fn(async()=>null),create:vi.fn(async()=>({id:'op'})),update:vi.fn()}
  const prisma={operationTask:task,operationRequest:request,reportTemplate:{findFirst:vi.fn(async()=>({id:'t',revision:1}))},reportDraft:{create:vi.fn()},$transaction:vi.fn()}
  const model={generateStructured:vi.fn(async()=>({json:{schemaVersion:2,title:'Başlık',summary:'Özet',detailedAnalysis:'Analiz',changes:[],affectedParties:[],effectiveDates:[],unresolvedReferences:[],evidence:[{id:'e1',documentVersionId:'e',excerpt:'Uydurulmuş alıntı'}]},usage:{inputTokens:1,outputTokens:1},providerRequestId:'p'}))}
  const store={putRunFile:vi.fn(),getContent:vi.fn()}
  const executors=createOperationExecutors({prisma:prisma as never,objectStore:store,aiModel:model,model:'test',extract:vi.fn()})
  await expect(executors.ANALYZE!({operation:'ANALYZE',mode:'FILL_MISSING',documentVersionIds:[],executionSnapshot:{sourceEvidence:input.evidence.map(d=>({...d,role:'PRIMARY'}))}},{taskId:'a',actorScope:'local-workspace',signal:new AbortController().signal})).rejects.toThrow('Kanıt alıntısı')
  expect(prisma.$transaction).not.toHaveBeenCalled();expect(store.putRunFile).not.toHaveBeenCalled()

 })
 it('requires report permissions before generating or writing',async()=>{
  const model={generateStructured:vi.fn()},prisma={operationRequest:{findUnique:vi.fn()}}
  await runWithActorContext({userId:'u',workspaceId:'w',identityId:'i',role:'VIEWER',permissions:['chat.write'],issuer:'test',subject:'u'},async()=>{
   await expect(new PrismaChatReportCreator(prisma as never,{putRunFile:vi.fn(),getContent:vi.fn()},model,'test').create(input)).rejects.toThrow('yetkisi')
  })
  expect(model.generateStructured).not.toHaveBeenCalled();expect(prisma.operationRequest.findUnique).not.toHaveBeenCalled()
 })
})
