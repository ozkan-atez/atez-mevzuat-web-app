import { getActorContext, privateActorScope, resourceOwnership } from '../../platform/actor-context'
import { installLocalWorkspaceBoundary } from '../../platform/local-workspace-access'
import { createHash } from 'node:crypto'
import { Prisma,type PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ObjectStore } from '../scan-runs/application/ports'
import { OperationError } from './operation-service'

/** Publishes only an explicitly selected immutable draft; never sends email. */
export class StandaloneReportsService {
 constructor(readonly prisma:PrismaClient,readonly objectStore:Pick<ObjectStore,'putRunFile'|'getContent'>,readonly defaultScope='local-workspace') {}
 get scope():string{return getActorContext()?privateActorScope():this.defaultScope}
 async list() {return {reports:await this.prisma.topicReport.findMany({where:{actorScope:this.scope,operationTaskId:{not:null},latestVersion:{gt:0}},orderBy:{updatedAt:'desc'},select:{id:true,title:true,latestVersion:true,operationTaskId:true,createdAt:true,updatedAt:true}})}}
 async get(id:string) {
  const report=await this.prisma.topicReport.findFirst({where:{id,actorScope:this.scope,operationTaskId:{not:null}},include:{revisions:{where:{status:'VALIDATED'},orderBy:{version:'desc'},include:{draft:{select:{operationTaskId:true,operationTask:{select:{requestId:true}}}}}}}})
  if(!report) throw new OperationError('Rapor bulunamadı.',404)
  return {...report,revisions:report.revisions.map(r=>({...r,operationTaskId:r.draft?.operationTaskId ?? null,operationRequestId:r.draft?.operationTask?.requestId ?? null}))}
 }
 async revision(id:string,version:number) {
  const report=await this.get(id),revision=report.revisions.find(r=>r.version===version)
  if(!revision)throw new OperationError('Rapor sürümü bulunamadı.',404)
  const bytes=await this.objectStore.getContent(revision.specObjectKey)
  return {...JSON.parse(bytes.toString('utf8')),reportId:id,version,createdAt:revision.createdAt,publicationStatus:'PUBLISHED'}
 }
 async publication(taskId:string): Promise<{reportId:string|null;expectedVersion:number;isPublished:boolean;version:number|null}> {
  const task=await this.prisma.operationTask.findFirst({where:{id:taskId,actorScope:this.scope,status:'SUCCEEDED'},include:{artifacts:true,drafts:{include:{revision:true}}}})
  const data=task?.artifacts.find(a=>a.kind==='REPORT_DRAFT')?.data
  if(!data || typeof data!=='object' || Array.isArray(data)) throw new OperationError('Rapor taslağı bulunamadı.',404)
  if(typeof (data as Record<string,unknown>).reusedFromTaskId==='string') return this.publication(String((data as Record<string,unknown>).reusedFromTaskId))
  let rootId=taskId,current=data as Record<string,unknown>;const seen=new Set([taskId])
  while(typeof current.previousReportTaskId==='string') {
   const id=current.previousReportTaskId
   if(seen.has(id) || seen.size>100)throw new OperationError('Rapor sürüm zinciri geçersiz.')
   seen.add(id)
   const ancestor=await this.prisma.operationTask.findFirst({where:{id,actorScope:this.scope,status:'SUCCEEDED'},include:{artifacts:true}})
   const previous=ancestor?.artifacts.find(a=>a.kind==='REPORT_DRAFT')?.data
   if(!previous || typeof previous!=='object' || Array.isArray(previous))throw new OperationError('Önceki rapor bulunamadı.',404)
   rootId=id;current=previous as Record<string,unknown>
  }
  const report=await this.prisma.topicReport.findUnique({where:{operationTaskId:rootId}}),revision=task?.drafts[0]?.revision
  return {reportId:report?.id ?? null,expectedVersion:report?.latestVersion ?? 0,isPublished:Boolean(revision),version:revision?.version ?? null}
 }
 async publish(taskId:string,expectedVersion:number): Promise<{reportId:string;version:number;operationTaskId:string}> {
  const task=await this.prisma.operationTask.findFirst({where:{id:taskId,actorScope:this.scope,status:'SUCCEEDED'},include:{artifacts:true,drafts:true}})
  const artifact=task?.artifacts.find(a=>a.kind==='REPORT_DRAFT'),draft=task?.drafts[0]
  if(!task || !artifact || !artifact.data || !draft) throw new OperationError('Yayımlanabilir rapor taslağı bulunamadı.',404)
  const data=artifact.data as Record<string,unknown>
  if(typeof data.html!=='string' || typeof data.title!=='string')throw new OperationError('Taslak rapor içeriği geçersiz.')
  if(typeof data.reusedFromTaskId==='string') { const publication=await this.publish(data.reusedFromTaskId,expectedVersion);await this.prisma.reportDraft.update({where:{id:draft.id},data:{status:'PUBLISHED',closedAt:new Date()}});return publication }
  const published=await this.prisma.reportRevision.findUnique({where:{draftId:draft.id}})
  if(published)return {reportId:published.reportId,version:published.version,operationTaskId:taskId}
  let rootId=taskId,ancestorData=data
  const seen=new Set([taskId])
  while(typeof ancestorData.previousReportTaskId==='string') {
   const id=ancestorData.previousReportTaskId
   if(seen.has(id) || seen.size>100)throw new OperationError('Rapor sürüm zinciri geçersiz.')
   seen.add(id)
   const ancestor=await this.prisma.operationTask.findFirst({where:{id,actorScope:this.scope,status:'SUCCEEDED'},include:{artifacts:true}})
   const previous=ancestor?.artifacts.find(a=>a.kind==='REPORT_DRAFT')?.data
   if(!previous || typeof previous!=='object' || Array.isArray(previous))throw new OperationError('Önceki rapor sürümü bulunamadı.',404)
   rootId=id;ancestorData=previous as Record<string,unknown>
  }
  const specObjectKey=`operations/${taskId}/published-spec.json`,htmlObjectKey=`operations/${taskId}/published.html`
  // Immutable keys scoped to this task. A later transaction failure leaves an unreachable object, not a published revision.
  await this.objectStore.putRunFile(specObjectKey,Buffer.from(JSON.stringify(data)),'application/json')
  await this.objectStore.putRunFile(htmlObjectKey,Buffer.from(data.html),'text/html')
  return this.prisma.$transaction(async tx=>{
   const lock=createHash('sha256').update(`standalone-report:${this.scope}:${rootId}`).digest().readBigInt64BE()
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lock})`
   const duplicate=await tx.reportRevision.findUnique({where:{draftId:draft.id}})
   if(duplicate)return {reportId:duplicate.reportId,version:duplicate.version,operationTaskId:taskId}
   let report=await tx.topicReport.findUnique({where:{operationTaskId:rootId}})
   if(report && report.actorScope!==this.scope)throw new OperationError('Rapor bulunamadı.',404)
   if((report?.latestVersion ?? 0)!==expectedVersion)throw new OperationError('Rapor sürümü değişti; güncel sürümü kontrol edin.',409,'VERSION_CONFLICT')
   if(!report)report=await tx.topicReport.create({data:{...resourceOwnership(),operationTaskId:rootId,actorScope:this.scope,title:String(data.title),basename:`belge-raporu-${rootId}`,card:'K5'}})
   const version=report.latestVersion+1
   await tx.reportRevision.create({data:{reportId:report.id,version,status:'VALIDATED',card:'K5',specObjectKey,htmlObjectKey,draftId:draft.id}})
   await tx.topicReport.update({where:{id:report.id},data:{title:String(data.title),latestVersion:version}})
   await tx.reportDraft.update({where:{id:draft.id},data:{status:'PUBLISHED',closedAt:new Date()}})
   return {reportId:report.id,version,operationTaskId:taskId}
  })
 }
}
export async function standaloneReportRoutes(app:FastifyInstance,{service}:{service:StandaloneReportsService}) {
 installLocalWorkspaceBoundary(app)
 const handle=async(reply:any,action:()=>Promise<unknown>)=>{try{return await action()}catch(error){if(error instanceof OperationError)return reply.code(error.statusCode).send({message:error.message,category:error.category});throw error}}
 app.get('/standalone-reports',(_request,reply)=>handle(reply,()=>service.list()))
 app.get('/standalone-reports/:id',(request,reply)=>handle(reply,()=>service.get((request.params as {id:string}).id)))
 app.get('/standalone-reports/:id/revisions/:version',(request,reply)=>handle(reply,async()=>{const params=z.object({id:z.string().min(1),version:z.coerce.number().int().positive()}).safeParse(request.params);if(!params.success)throw new OperationError('Rapor sürümü geçersiz.',400);return service.revision(params.data.id,params.data.version)}))
 app.get('/operation-tasks/:id/publication',(request,reply)=>handle(reply,()=>service.publication((request.params as {id:string}).id)))
 app.post('/operation-tasks/:id/publish',(request,reply)=>handle(reply,async()=>{const parsed=z.object({expectedVersion:z.number().int().min(0).default(0)}).strict().safeParse(request.body ?? {});if(!parsed.success)throw new OperationError('Rapor sürümü bilgisi geçersiz.',400);return service.publish((request.params as {id:string}).id,parsed.data.expectedVersion)}))
}
