import type {FastifyInstance} from 'fastify'
import type {PrismaClient,Prisma} from '@prisma/client'
import {DateTime} from 'luxon'
import {z} from 'zod'
import {getActorContext,chatAccessWhere,reportAccessWhere} from '../../platform/actor-context'
export const usageQuery=z.object({from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),category:z.enum(['GENERAL_CHAT','REPORT_REVISION','SCAN_ANALYSIS','SOURCE_SETUP','TEMPLATE_GENERATION']).optional(),actorId:z.string().optional(),reportId:z.string().optional(),team:z.enum(['true','false']).default('false'),page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)})
export function usageDateRange(from?:string,to?:string) {
 const first=DateTime.fromISO(from??DateTime.now().setZone('Europe/Istanbul').startOf('month').toISODate()!,{zone:'Europe/Istanbul'}).startOf('day')
 const last=DateTime.fromISO(to??DateTime.now().setZone('Europe/Istanbul').toISODate()!,{zone:'Europe/Istanbul'}).plus({days:1}).startOf('day')
 if(!first.isValid||!last.isValid||first>=last)throw new Error('Geçerli bir tarih aralığı seçin.')
 return {gte:first.toJSDate(),lt:last.toJSDate()}
}
export async function usageRoutes(app:FastifyInstance,{prisma}:{prisma:PrismaClient}) {
 app.get('/api/v1/usage',async(request,reply)=>{
  const parsed=usageQuery.safeParse(request.query);if(!parsed.success)return reply.code(400).send({message:'Geçerli kullanım filtreleri seçin.'})
  const q=parsed.data,actor=getActorContext(),canViewTeam=actor?.permissions.includes('usage.team.read')??false
  if((q.team==='true'||q.actorId&&q.actorId!==actor?.userId)&&!canViewTeam)return reply.code(403).send({message:'Ekip tüketimini görüntüleme yetkiniz yok.'})
  let range;try{range=usageDateRange(q.from,q.to)}catch(error){return reply.code(400).send({message:(error as Error).message})}
  const where:Prisma.AiUsageEventWhereInput={workspaceId:actor?.workspaceId??null,...(q.team==='true'?q.actorId?{actorUserId:q.actorId}:{}:{actorUserId:actor?.userId??null}),createdAt:range,...(q.category?{category:q.category}:{}),...(q.reportId?{reportId:q.reportId}:{})}
  const [totals,categories,total,events,unknownMeasurements]=await Promise.all([prisma.aiUsageEvent.aggregate({where,_sum:{inputTokens:true,outputTokens:true,totalTokens:true},_count:true}),prisma.aiUsageEvent.groupBy({by:['category'],where,_sum:{totalTokens:true},_count:true}),prisma.aiUsageEvent.count({where}),prisma.aiUsageEvent.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.limit,take:q.limit}),prisma.aiUsageEvent.count({where:{...where,totalTokens:null,status:{not:'NO_AI'}}})])
  const sessionIds=events.flatMap(e=>e.sessionId?[e.sessionId]:[]),reportIds=events.flatMap(e=>e.reportId?[e.reportId]:[])
  const [sessions,reports,users,reportOptions,actorOptions]=await Promise.all([prisma.chatSession.findMany({where:{id:{in:sessionIds},...chatAccessWhere()},select:{id:true,title:true}}),prisma.topicReport.findMany({where:{id:{in:reportIds},...reportAccessWhere()},select:{id:true,topicId:true,title:true}}),prisma.user.findMany({where:{id:{in:[...new Set(events.flatMap(e=>e.actorUserId?[e.actorUserId]:[]))]}},select:{id:true,name:true}}),prisma.topicReport.findMany({where:reportAccessWhere(),select:{id:true,title:true},orderBy:{updatedAt:'desc'},take:100}),canViewTeam&&actor?prisma.user.findMany({where:{memberships:{some:{workspaceId:actor.workspaceId,active:true}}},select:{id:true,name:true},orderBy:{name:'asc'},take:100}):Promise.resolve([])])
  return {filterOptions:{reports:reportOptions.map(r=>({value:r.id,label:r.title??'Adsız rapor'})),actors:actorOptions.map(u=>({value:u.id,label:u.name??'Adsız kullanıcı'}))},unknownMeasurements,summary:{inputTokens:totals._sum.inputTokens,outputTokens:totals._sum.outputTokens,totalTokens:totals._sum.totalTokens,operations:totals._count},categories:categories.map(c=>({category:c.category,totalTokens:c._sum.totalTokens,operations:c._count})),events:events.map(e=>{
   const session=sessions.find(s=>s.id===e.sessionId),report=reports.find(r=>r.id===e.reportId)
   return {...e,sessionId:session?.id??null,reportId:report?.id??null,messageId:session?e.messageId:null,title:session?.title??report?.title??(report?'Rapor revizyonu':'AI işlemi'),actorName:users.find(u=>u.id===e.actorUserId)?.name??'Kullanıcı',href:session?`/chat/${session.id}`:report?`/chat?report=${report.id}`:null,measurement:e.status==='NO_AI'?'NO_AI':e.totalTokens===null?'UNKNOWN':'REPORTED'}
  }),total,page:q.page,limit:q.limit,canViewTeam,legacyNotice:'Sağlayıcı ölçümleri ve aktarılmış geçmiş işlem kayıtları gösterilir. Eski sohbetlerin eksik tüketimleri tahmin edilmez.'}
 })
}
