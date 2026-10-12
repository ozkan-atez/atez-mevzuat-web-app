import type { FastifyInstance } from 'fastify'
import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { getActorContext } from '../../platform/actor-context'
import type { TopicObjectStore } from '../topic-analysis/application/ports'
import type { AiModelClient } from '../ai/application/ai-model-client'
import { ReportFieldEditSchema, ReportPatchError } from '../topic-analysis/domain/report-patch'
import { ReportWorkspaceService, WorkspaceError } from './report-workspace.service'

export async function reportWorkspaceRoutes(app:FastifyInstance,options:{prisma:PrismaClient;objectStore?:Pick<TopicObjectStore,'getContent'|'putRunFile'>;aiModel?:AiModelClient;model?:string}){
 const service=options.objectStore?new ReportWorkspaceService(options.prisma,options.objectStore,options.aiModel,options.model):null
 app.addHook('preHandler',async(request,reply)=>{const actor=getActorContext(),permission=request.method==='GET'?'report.read':request.url.endsWith('/publish')?'report.publish':'report.edit';if(actor&&!actor.permissions.includes(permission))return reply.code(403).send({message:'Bu işlem için yetkiniz bulunmuyor.'});if(!service)return reply.code(503).send({message:'Rapor deposu kullanılamıyor.'})})
 app.setErrorHandler((error,_request,reply)=>{if(error instanceof WorkspaceError)return reply.code(error.status).send({message:error.message,...error.details});if(error instanceof Prisma.PrismaClientKnownRequestError && ['P2002','P2034'].includes(error.code))return reply.code(409).send({message:'Rapor başka bir işlem tarafından güncellendi. Güncel taslağı açıp tekrar deneyin.',category:'DRAFT_UPDATED'});if(error instanceof z.ZodError||error instanceof ReportPatchError)return reply.code(400).send({message:error instanceof ReportPatchError?error.message:'İstek bilgileri geçersiz.'});app.log.error(error);return reply.code(500).send({message:'Rapor işlemi tamamlanamadı.'})})
 const params=(request:{params:unknown})=>z.object({id:z.string().min(1),conversationId:z.string().optional(),version:z.coerce.number().int().positive().optional()}).parse(request.params)
 const page=(query:unknown)=>z.object({cursor:z.string().optional()}).parse(query).cursor
 app.get('/',request=>service!.list(page(request.query)))
 app.get('/:id',request=>service!.state(params(request).id))
 app.get('/:id/conversations',request=>service!.conversations(params(request).id,page(request.query)))
 app.post('/:id/conversations',request=>service!.createConversation(params(request).id,z.object({title:z.string().trim().min(1).max(150)}).strict().parse(request.body).title))
 app.post('/:id/conversations/:conversationId/archive',async request=>{const p=params(request);await service!.conversation(p.id,p.conversationId!);return options.prisma.reportConversation.update({where:{id:p.conversationId!},data:{archivedAt:new Date()}})})
 app.get('/:id/conversations/:conversationId/messages',request=>{const p=params(request);return service!.messages(p.id,p.conversationId!,page(request.query))})
 app.post('/:id/conversations/:conversationId/messages',request=>{const p=params(request),body=z.object({content:z.string().trim().min(1).max(12000)}).strict().parse(request.body),key=z.string().uuid().parse(request.headers['idempotency-key']);return service!.propose(p.id,p.conversationId!,body.content,key)})
 app.get('/:id/revisions',async request=>({revisions:await service!.versions(params(request).id)}))
 app.get('/:id/revisions/:version',request=>{const p=params(request);return service!.version(p.id,p.version!)})
 app.get('/:id/compare',request=>{const p=params(request),q=z.object({from:z.coerce.number().int().positive(),to:z.coerce.number().int().positive()}).parse(request.query);return service!.compare(p.id,q.from,q.to)})
 app.post('/:id/draft/apply',request=>{const body=z.object({expectedRevision:z.string(),edits:z.array(ReportFieldEditSchema).max(50).optional(),messageId:z.string().optional(),paths:z.array(z.string()).max(50).optional(),forcePaths:z.array(z.string()).max(50).optional(),fromVersion:z.number().int().positive().optional()}).strict().parse(request.body);return service!.apply(params(request).id,{...body,requestKey:z.string().uuid().parse(request.headers['idempotency-key'])})})
 app.post('/:id/draft/restore',request=>{const body=z.object({expectedRevision:z.string(),fromVersion:z.number().int().positive()}).strict().parse(request.body);return service!.restore(params(request).id,body.fromVersion,body.expectedRevision)})
 app.post('/:id/draft/publish',request=>service!.publish(params(request).id,z.object({expectedRevision:z.string()}).strict().parse(request.body).expectedRevision))
}
