import {PrismaClient} from '@prisma/client'
import {randomUUID} from 'node:crypto'
import {describe,it,expect,afterAll} from 'vitest'
import {PrismaChatReportCreator} from '../../src/modules/chat/infrastructure/prisma-chat-report-creator'
import {OperationService} from '../../src/modules/operations/operation-service'
import {createOperationExecutors} from '../../src/modules/operations/executors'
import {defaultTemplateDefinition} from '../../src/modules/workspace/template-definition'
import {sampleTemplateContent} from '../../src/modules/workspace/template-renderer'
import {applyReportPatch} from '../../src/modules/topic-analysis/domain/report-patch'
import {assertReportLayoutPreserved} from '../../src/modules/topic-analysis/application/preserve-report-layout'
import {renderValidatedReport} from '../../src/modules/topic-analysis/application/produce-report-document'

describe.skipIf(!process.env.TEST_DATABASE_URL)('durable chat report batch',()=>{
 const prisma=new PrismaClient()
 afterAll(()=>prisma.$disconnect())
 it('isolates two reports, resumes a failed group, publishes once and preserves the template during edits',async()=>{
  const template=await prisma.reportTemplate.create({data:{name:`batch-test-${randomUUID()}`,html:'{{sections}}',sections:[],definition:defaultTemplateDefinition()}})
  let requestId:string|undefined,failSecond=true
  const files=new Map<string,Buffer>()
  const store={putRunFile:async(key:string,body:Buffer,mediaType:string)=>{files.set(key,body);return {bucket:'test',objectKey:key,sha256:'a'.repeat(64),byteSize:BigInt(body.length),mediaType}},getContent:async(key:string)=>{const value=files.get(key);if(!value)throw new Error('Missing object');return value}}
  const model={generateStructured:async(request:any)=>{
    const input=JSON.parse(request.parts[0].text)
    let json:any
    if(input.expectedReportCount)json={groups:['a','b'].map(id=>({title:`Rapor ${id}`,instruction:`Yalnız ${id} kaynağını raporla`,sources:[{id,role:'PRIMARY'}]}))}
    else if(input.documents){
      const d=input.documents[0]
      if(d.id==='b'&&failSecond){failSecond=false;throw new Error('Simulated provider failure')}
      json={schemaVersion:2,title:`Rapor ${d.id}`,summary:`Özet ${d.id}`,detailedAnalysis:d.text,changes:[],affectedParties:[],effectiveDates:[],unresolvedReferences:[],evidence:[{id:'e1',documentVersionId:d.id,excerpt:d.text}]}
    }else{
      json=sampleTemplateContent(input.definition)
      json.sections.forEach((s:any)=>{s.evidenceIds=['e1'];s.fields.forEach((f:any)=>{f.text=input.evidence.analysis.detailedAnalysis})})
    }
    return {json,usage:{inputTokens:1,outputTokens:1},providerRequestId:null}
  }}
  try{
    const creator=new PrismaChatReportCreator(prisma,store,model,'test')
    const input={sessionId:randomUUID(),messageId:randomUUID(),templateId:template.id,instruction:'İki ayrı rapor oluştur',warnings:[],evidence:['a','b'].map(id=>({id,title:`Belge ${id}`,text:`Yalnız ${id} belgesinin metni.`,url:null,publishedOn:null}))}
    const batch=await creator.create(input);requestId=batch.operationRequestIds[0]!
    expect(batch).toMatchObject({expectedCount:2,pending:true,reports:[]})
    const service=new OperationService(prisma,{executors:createOperationExecutors({prisma,objectStore:store,aiModel:model,model:'test',extract:async()=>{throw new Error('unexpected extraction')}})})
    let request=await service.get(requestId)
    expect(request.tasks).toHaveLength(6)
    expect(await prisma.operationOutbox.count({where:{taskId:{in:request.tasks.map(t=>t.id)}}})).toBe(6)
    for(const operation of ['ANALYZE','BUILD_REPORT','PUBLISH_REPORT'])for(const task of request.tasks.filter(t=>t.operation===operation))await service.execute(task.id)
    request=await service.get(requestId)
    expect(request.status).toBe('PARTIAL')
    const completed=request.tasks.filter(t=>t.operation==='PUBLISH_REPORT'&&t.status==='SUCCEEDED')
    expect(completed).toHaveLength(1)
    const failed=request.tasks.find(t=>t.operation==='ANALYZE'&&t.status==='FAILED')!
    await service.retry(failed.id)
    request=await service.get(requestId)
    for(const operation of ['ANALYZE','BUILD_REPORT','PUBLISH_REPORT'])for(const task of request.tasks.filter(t=>t.operation===operation))await service.execute(task.id)
    request=await service.get(requestId)
    expect(request.status).toBe('SUCCEEDED')
    const replay=await creator.create(input)
    expect(replay.reports).toHaveLength(2);expect(replay.pending).toBe(false)
    for(const task of request.tasks)await service.execute(task.id)
    expect(await prisma.topicReport.count({where:{operationTaskId:{in:request.tasks.map(t=>t.id)}}})).toBe(2)
    const drafts=request.tasks.filter(t=>t.operation==='BUILD_REPORT').map(t=>t.artifacts.find(a=>a.kind==='REPORT_DRAFT')!.data as any)
    for(const draft of drafts){
      const own=draft.sourceContext[0].documentVersionId
      expect(draft.sourceContext).toHaveLength(1)
      expect(draft.html).toContain(`Yalnız ${own} belgesinin metni.`)
      expect(draft.html).not.toContain(`Yalnız ${own==='a'?'b':'a'} belgesinin metni.`)
      expect(draft.reportSpec.customization.templateReport.definition).toEqual(defaultTemplateDefinition())
    }
    const base=drafts[1].reportSpec,path='customization.templateReport.content.sections.0.fields.0.text'
    const revised=applyReportPatch(base,{edits:[{path,value:'Kısaltılmış özet'}]}).spec
    expect(()=>assertReportLayoutPreserved(base,revised)).not.toThrow()
    expect(await renderValidatedReport(revised)).toContain('Kısaltılmış özet')
    expect(drafts[1].html).not.toContain('Kısaltılmış özet')
    const drift=structuredClone(revised);drift.customization!.templateReport!.definition.theme.fontSize+=2
    expect(()=>assertReportLayoutPreserved(base,drift)).toThrow('şablonunu')
  }finally{
    if(requestId){
      const tasks=await prisma.operationTask.findMany({where:{requestId},select:{id:true}})
      await prisma.topicReport.deleteMany({where:{operationTaskId:{in:tasks.map(t=>t.id)}}})
      const taskIds=tasks.map(t=>t.id)
      await prisma.reportDraft.deleteMany({where:{operationTaskId:{in:taskIds}}})
      await prisma.operationArtifact.deleteMany({where:{taskId:{in:taskIds}}})
      await prisma.operationAttempt.deleteMany({where:{taskId:{in:taskIds}}})
      await prisma.operationOutbox.deleteMany({where:{taskId:{in:taskIds}}})
      await prisma.operationTask.deleteMany({where:{requestId}})
      await prisma.operationRequest.delete({where:{id:requestId}})
    }
    await prisma.reportTemplate.delete({where:{id:template.id}})
  }
 },30000)
})
