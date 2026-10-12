import { installLocalWorkspaceBoundary } from '../../platform/local-workspace-access'
import type { FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'
import { DateTime } from 'luxon'
import { ZodError } from 'zod'
import { OperationError,OperationInputSchema,type OperationService } from './operation-service'

/** Explicit single-stage execution against an automation's configuration; schedule and delivery remain untouched. */
export async function automationOperationRoutes(app:FastifyInstance,{service}:{service:OperationService}) {
 installLocalWorkspaceBoundary(app)
 app.post('/automations/:id/operations',async(request,reply)=>{
  try {
   const id=(request.params as {id:string}).id
   const automation=await service.prisma.workspaceAutomation.findUnique({where:{id}})
   if(!automation)throw new OperationError('Otomasyon bulunamadı.',404)
   const input=OperationInputSchema.parse(request.body)
   if(input.sourceId && !automation.sourceIds.includes(input.sourceId))throw new OperationError('Kaynak bu otomasyonun kapsamına ait değil.')
   if(['DISCOVER','CAPTURE'].includes(input.operation)) {
    if(!input.sourceId && automation.sourceIds.length===1)input.sourceId=automation.sourceIds[0]!
    if(!input.sourceId)throw new OperationError('Otomasyonun hangi kaynağını çalıştıracağınızı seçin.')
    if(!input.date && input.operation==='DISCOVER')throw new OperationError('Hedef tarihi açıkça seçin.')
    input.datePolicy=automation.datePolicy==='NEW_OR_CHANGED'?'NEW_OR_CHANGED':'PUBLISHED_DATE'
   }
   if(input.sourceRunId) {
    const run=await service.prisma.sourceScanRun.findUnique({where:{id:input.sourceRunId},include:{scanRun:true}})
    if(run?.scanRun?.automationId!==id)throw new OperationError('Kaynak çalışması bu otomasyona ait değil.',404)
   }
   if(input.operation==='BUILD_REPORT' && !input.templateId && automation.templateId)input.templateId=automation.templateId
   input.automationId=id
   const key=String(request.headers['idempotency-key'] ?? '')
   if(!key || key.length > 200)throw new OperationError('Idempotency-Key gereklidir ve en fazla 200 karakter olabilir.',400)
   const operation=await service.start(input,`automation-stage:${createHash('sha256').update(`${id}:${key}`).digest('hex')}`)
   return reply.code(operation.status==='SUCCEEDED'?200:202).send({...operation,automation:{id,name:automation.name,timezone:automation.timezone,configuredTimes:automation.times.length?automation.times:[`${String(automation.hour).padStart(2,'0')}:${String(automation.minute).padStart(2,'0')}`],evaluatedAt:DateTime.now().setZone(automation.timezone).toISO()},publicationMode:'MANUAL_APPROVAL'})
  } catch(error) {
   if(error instanceof OperationError)return reply.code(error.statusCode).send({message:error.message,category:error.category})
   if(error instanceof ZodError)return reply.code(400).send({message:'İşlem girdileri geçersiz.'})
   throw error
  }
 })
}
