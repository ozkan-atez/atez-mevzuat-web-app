import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { ChatReportError, type ChatReportCreator, type QueuedChatReports } from '../application/create-chat-report'
import { planChatReports } from '../application/plan-chat-reports'
import type { AiModelClient } from '../../ai/application/ai-model-client'
import { operationHash } from '../../operations/operation-service'
import { getActorContext, hasPermission, privateActorScope, resourceOwnership } from '../../../platform/actor-context'
import { withUsageContext } from '../../usage/usage-context'
import type { ObjectStore } from '../../scan-runs/application/ports'
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue
const included={tasks:{include:{artifacts:true}}} as const

/** Chat plans work; the durable operation worker performs analysis, rendering and publication. */
export class PrismaChatReportCreator implements ChatReportCreator {
  constructor(private prisma:PrismaClient,_store:Pick<ObjectStore,'putRunFile'|'getContent'>,private model:AiModelClient,private modelName:string){}
  async create(input:Parameters<ChatReportCreator['create']>[0]):Promise<QueuedChatReports> {
    const actor=getActorContext()
    if(actor&&(!hasPermission(actor,'report.edit')||!hasPermission(actor,'report.publish')||!hasPermission(actor,'analysis.run')))throw new ChatReportError('Analiz, rapor oluşturma ve kaydetme yetkisi gerekli.')
    const scope=privateActorScope(),ownership=resourceOwnership(),idempotencyKey=`chat-report:${input.messageId}`
    const lookup=()=>this.prisma.operationRequest.findUnique({where:{actorScope_idempotencyKey:{actorScope:scope,idempotencyKey}},include:included})
    const result=(request:NonNullable<Awaited<ReturnType<typeof lookup>>>):QueuedChatReports=>{
      const parameters=request.parameters as Record<string,unknown>
      const reports=request.tasks.flatMap(t=>t.artifacts.filter(a=>a.kind==='PUBLISHED_REPORT').map(a=>{
        const data=a.data as {reportId:string;title:string}
        return {...data,url:`/reports/documents/${data.reportId}`,operationRequestId:request.id}
      }))
      return {expectedCount:Number(parameters.expectedCount??1),operationRequestIds:[request.id],reports,pending:request.status!=='SUCCEEDED'}
    }
    const previous=await lookup()
    if(previous)return result(previous)
    const template=input.templateId?await this.prisma.reportTemplate.findFirst({where:{id:input.templateId,isActive:true}}):await this.prisma.reportTemplate.findFirst({where:{isActive:true},orderBy:{createdAt:'asc'}})
    if(!template)throw new ChatReportError('Etkin rapor şablonu bulunamadı. Şablon seçimini kontrol edin.')
    const groups=await withUsageContext({conversationId:input.sessionId,conversationType:'GENERAL',messageId:input.messageId,mode:'ANALYSIS',usageLabel:'Rapor kaynak grupları'},()=>planChatReports(input.instruction,input.evidence,this.model,this.modelName))
    input.signal?.throwIfAborted()
    const parameters={instruction:input.instruction,templateId:template.id,conversationId:input.sessionId,messageId:input.messageId,expectedCount:groups.length,groups}
    try {
      const request=await this.prisma.$transaction(async tx=>{
        const request=await tx.operationRequest.create({data:{...ownership,actorScope:scope,idempotencyKey,payloadHash:operationHash(parameters),operation:'BUILD_REPORT',mode:'FILL_MISSING',parameters:json(parameters),status:'QUEUED'}})
        for(const [index,group] of groups.entries()){
          const analysisId=randomUUID(),reportId=randomUUID(),publishId=randomUUID()
          const evidence=group.sources.map(source=>({...input.evidence.find(e=>e.id===source.id)!,role:source.role}))
          const snapshot={template:{id:template.id,revision:template.revision,sections:template.sections,definition:template.definition,html:template.html},sourceEvidence:evidence,coverageWarnings:input.warnings,group:{index:index+1,title:group.title},conversationId:input.sessionId,messageId:input.messageId}
          const common={mode:'FILL_MISSING',documentVersionIds:[],instruction:group.instruction,templateId:template.id,executionSnapshot:snapshot}
          for(const stage of [
            {id:analysisId,operation:'ANALYZE',dependencies:[],parameters:{...common,operation:'ANALYZE'}},
            {id:reportId,operation:'BUILD_REPORT',dependencies:[analysisId],parameters:{...common,operation:'BUILD_REPORT',analysisTaskId:analysisId}},
            {id:publishId,operation:'PUBLISH_REPORT',dependencies:[reportId],parameters:{...common,operation:'PUBLISH_REPORT',reportTaskId:reportId}},
          ]){
            await tx.operationTask.create({data:{...ownership,id:stage.id,requestId:request.id,actorScope:scope,operation:stage.operation,inputSignature:operationHash({requestId:request.id,group:index,stage:stage.operation}),parameters:json(stage.parameters),dependencyIds:stage.dependencies,status:'QUEUED'}})
            await tx.operationOutbox.create({data:{taskId:stage.id}})
          }
        }
        return tx.operationRequest.findUniqueOrThrow({where:{id:request.id},include:included})
      })
      return result(request)
    }catch(error){
      if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2002'){
        const raced=await lookup();if(raced)return result(raced)
      }
      throw error
    }
  }
}
