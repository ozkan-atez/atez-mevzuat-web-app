import { withUsageContext } from '../usage/usage-context'
import { Prisma,type PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { documentAccessWhere,reportAccessWhere,resourceOwnership,privateActorScope } from '../../platform/actor-context'
import { analyzeSourceEvidence } from './executors'
import { operationHash,OperationError } from './operation-service'
import type { AiModelClient } from '../ai/application/ai-model-client'
import { ChatEvidenceSchema } from '../chat/application/create-chat-report'
import type { ObjectStore } from '../scan-runs/application/ports'

export class ReportAnalysisService {
 constructor(private prisma:PrismaClient,private store:Pick<ObjectStore,'getContent'>,private model?:AiModelClient,private modelName='gemini-3.7-flash'){}
 async read(id:string) {
  const report=await this.prisma.topicReport.findFirst({where:{AND:[reportAccessWhere(),{OR:[{id},{topicId:id}]}]},include:{topic:{include:{analyses:{orderBy:{version:'desc'},take:1}}},operationTask:{include:{artifacts:true}},revisions:{orderBy:{version:'desc'},take:1}}})
  if(!report)throw new OperationError('Rapor bulunamadı.',404)
  if(report.topic){const a=report.topic.analyses[0];if(!a)throw new OperationError('Kayıtlı analiz bulunamadı.',404);return {report,analysis:null,task:null,text:(await this.store.getContent(a.markdownObjectKey)).toString('utf8'),version:a.version}}
  const latest=await this.prisma.operationTask.findFirst({where:{actorScope:report.actorScope ?? privateActorScope(),status:'SUCCEEDED',operation:'REVISE_ANALYSIS',request:{parameters:{path:['reportId'],equals:report.id}}},orderBy:{createdAt:'desc'},include:{artifacts:true}})
  const data=report.operationTask?.artifacts.find(a=>a.kind==='REPORT_DRAFT')?.data as Record<string,any>|undefined
  const task=latest??(typeof data?.analysisTaskId==='string'?await this.prisma.operationTask.findUnique({where:{id:data.analysisTaskId},include:{artifacts:true}}):null)
  const analysis=task?.artifacts.find(a=>a.kind==='ANALYSIS')?.data as Record<string,any>|undefined
  if(!analysis)throw new OperationError('Kayıtlı analiz bulunamadı.',404)
  return {report,analysis,task,text:[analysis.title,analysis.summary,analysis.detailedAnalysis,...(analysis.unresolvedReferences??[]).map((s:string)=>`Eksik bilgi: ${s}`),'Kaynak dayanakları:',...(analysis.evidence??[]).map((e:any)=>`• ${e.excerpt}`)].join('\n\n'),version:latest?task!.createdAt.toISOString():'İlk analiz'}
 }
 async rerun(id:string,instruction:string,key:string) {
  const current=await this.read(id)
  if(current.report.topicId)throw new OperationError('Konu analizleri mevcut analiz kuyruğundan yürütülmelidir.')
  if(!this.model)throw new OperationError('Analiz modeli kullanılamıyor.',503)
  let documents=ChatEvidenceSchema.array().safeParse(current.analysis?.sourceEvidence)
  if(!documents.success){
    const ids=(current.analysis?.sourceContext??[]).map((s:any)=>s.documentVersionId).filter((id:unknown):id is string=>typeof id==='string')
    const versions=await this.prisma.documentVersion.findMany({where:{id:{in:ids},document:documentAccessWhere()},include:{document:true}})
    documents=ChatEvidenceSchema.array().safeParse(versions.map(v=>({id:v.id,title:v.document.title,text:v.extractedText,url:v.document.canonicalUrl,publishedOn:v.document.publishedOn?.toISOString().slice(0,10)??null})))
  }
  if(!documents.success||!documents.data.length)throw new OperationError('Analizin kaynak metinleri bulunamadı; yeniden kaynak seçimi gerekli.',422)
  const actorScope=privateActorScope(),ownership=resourceOwnership(),idempotencyKey=`report-analysis:${id}:${key}`
  const prior=await this.prisma.operationRequest.findUnique({where:{actorScope_idempotencyKey:{actorScope,idempotencyKey}}})
  if(prior?.status==='SUCCEEDED')return
  if(prior)throw new OperationError('Bu analiz isteği daha önce kaydedildi; durumunu kontrol edin.',409)
  const taskId=randomUUID(),parameters={reportId:current.report.id,instruction,previousAnalysisTaskId:current.task?.id}
  const request=await this.prisma.operationRequest.create({data:{...ownership,actorScope,idempotencyKey,payloadHash:operationHash(parameters),operation:'REVISE_ANALYSIS',mode:'FORCE',parameters:parameters as Prisma.InputJsonValue,status:'RUNNING',tasks:{create:{...ownership,id:taskId,actorScope,operation:'REVISE_ANALYSIS',inputSignature:operationHash(parameters),parameters:parameters as Prisma.InputJsonValue,status:'RUNNING'}}}})
  try {
    const {analysis,response}=await withUsageContext({conversationId:id,conversationType:'REPORT',messageId:`report-analysis:${id}:${key}`,mode:'ANALYSIS',usageLabel:'Rapor analizi yenileme'},()=>analyzeSourceEvidence({documents:documents.data,instruction,warnings:current.analysis?.coverageWarnings ?? []},this.model!,this.modelName))
    await this.prisma.$transaction(async tx=>{
      await tx.operationTask.update({where:{id:taskId},data:{status:'SUCCEEDED',artifacts:{create:{kind:'ANALYSIS',data:JSON.parse(JSON.stringify({...analysis,sourceEvidence:documents.data,sourceContext:current.analysis?.sourceContext,usage:response.usage}))}}}})
      await tx.operationRequest.update({where:{id:request.id},data:{status:'SUCCEEDED'}})
    })
  }catch(error){await this.prisma.operationTask.update({where:{id:taskId},data:{status:'FAILED',errorMessage:'Analiz tamamlanamadı.'}});await this.prisma.operationRequest.update({where:{id:request.id},data:{status:'FAILED'}});throw error}
 }
}
