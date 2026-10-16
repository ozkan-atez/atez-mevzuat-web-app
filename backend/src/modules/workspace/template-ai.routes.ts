import { AiProviderError } from '../ai/domain/ai-errors'
import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { Prisma,type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import type { AiModelClient } from '../ai/application/ai-model-client'
import { privateActorScope,documentAccessWhere } from '../../platform/actor-context'
import { TemplateDefinitionSchema } from './template-definition'
import { generateTemplateReport,suggestTemplate,TemplateGenerationError } from './template-ai'
import { renderTemplateReport,sampleTemplateContent,renderTemplateComponent } from './template-renderer'

export async function templateAiRoutes(app:FastifyInstance,{prisma,aiModel,modelName='gemini-3.7-flash'}:{prisma:PrismaClient;aiModel?:AiModelClient;modelName?:string}) {
  app.post('/api/v1/templates/preview',async(request,reply)=>{
    const body=z.object({definition:TemplateDefinitionSchema,title:z.string().max(300).default('Rapor önizlemesi'),componentIds:z.array(z.string().max(80)).min(1).max(40).optional()}).safeParse(request.body)
    if(!body.success)return reply.code(400).send({message:body.error.issues[0]?.message ?? 'Şablon geçersiz.'})
    if(body.data.componentIds){
      if(body.data.componentIds.some(id=>!body.data.definition.components.some(c=>c.id===id)))return reply.code(400).send({message:'Bileşen bulunamadı.'})
      return {components:Object.fromEntries(body.data.componentIds.map(id=>[id,renderTemplateComponent(body.data.definition,id)]))}
    }
    return {html:renderTemplateReport({definition:body.data.definition,content:sampleTemplateContent(body.data.definition),sources:[],revision:null},{title:body.data.title,reportId:'Önizleme',date:''},true)}
  })
  const schema=z.object({requestKey:z.string().uuid(),definition:TemplateDefinitionSchema,mode:z.enum(['CONTENT','DESIGN','COMPONENT','TRIAL']),instruction:z.string().trim().max(8000).default(''),conversation:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().max(12000)}).strict()).max(12).default([]),sourceText:z.string().max(100000).default(''),documentVersionIds:z.array(z.string().min(1)).max(10).default([]),title:z.string().max(300).default('Deneme raporu')}).strict()
  app.post('/api/v1/templates/ai',async(request,reply)=>{
    const parsed=schema.safeParse(request.body)
    if(!parsed.success)return reply.code(400).send({message:parsed.error.issues[0]?.message ?? 'Şablon geçersiz.'})
    if(!aiModel)return reply.code(503).send({message:'AI sağlayıcısı yapılandırılmamış. Elle düzenlemeye devam edebilirsiniz.'})
    const b=parsed.data
    if(b.mode!=='TRIAL' && !b.instruction)return reply.code(400).send({message:'Yapılmasını istediğiniz değişikliği yazın.'})
    if(b.mode==='TRIAL' && !b.sourceText.trim() && !b.documentVersionIds.length)return reply.code(400).send({message:'Denemek için kaynak metni veya belge seçin.'})
    const actorScope=privateActorScope(),inputHash=createHash('sha256').update(JSON.stringify({...b,requestKey:undefined})).digest('hex')
    const where={actorScope_requestKey:{actorScope,requestKey:b.requestKey}}
    let job=await prisma.templateAiRequest.findUnique({where})
    if(job) {
      if(job.inputHash!==inputHash)return reply.code(409).send({message:'İstek anahtarı farklı bir işlemde kullanılmış.'})
      if(job.status==='COMPLETED')return job.result
      return reply.code(409).send({message:job.status==='RUNNING'?'Bu AI isteği işleniyor.':'Önceki deneme başarısız oldu; yeni bir istekle tekrar deneyin.'})
    }
    try {job=await prisma.templateAiRequest.create({data:{actorScope,requestKey:b.requestKey,inputHash,model:modelName}})}
    catch(error) {if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2002')return reply.code(409).send({message:'Bu istek zaten işleniyor.'});throw error}
    try {
      const measuredModel:AiModelClient={generateStructured:async input=>{const response=await aiModel.generateStructured({...input,onUsage:async usage=>{await prisma.templateAiRequest.update({where:{id:job!.id},data:{usage:usage as unknown as Prisma.InputJsonValue}});await input.onUsage?.(usage)}});await prisma.templateAiRequest.update({where:{id:job!.id},data:{usage:response.usage as Prisma.InputJsonValue}});return response}}
      let result:unknown,usage:unknown
      if(b.mode==='TRIAL') {
        const docs=b.documentVersionIds.length?await prisma.documentVersion.findMany({where:{id:{in:b.documentVersionIds},document:documentAccessWhere(actorScope)},include:{document:true}}):[]
        if(docs.length!==new Set(b.documentVersionIds).size || docs.some(d=>!d.extractedText))throw new TemplateGenerationError('Seçilen belgeler bulunamadı veya metinleri hazır değil.')
        const sources=[...(b.sourceText.trim()?[{id:'provided-text',label:'Kullanıcının deneme için sağladığı kaynak metni',url:null,excerpt:b.sourceText}]:[]),...docs.map(d=>({id:d.id,label:d.document.title,url:d.document.canonicalUrl,excerpt:d.extractedText!}))]
        if(JSON.stringify(sources).length>150000)throw new TemplateGenerationError('Deneme kaynakları çok uzun; daha az belge seçin.')
        const generated=await generateTemplateReport({definition:b.definition,revision:null,sources,evidence:{note:'Deneme kaynakları; resmîlik doğrulanmamıştır.'},model:measuredModel,modelName,allowBlocked:true})
        usage=generated.usage
        result={report:generated.report,issues:generated.issues,html:renderTemplateReport(generated.report,{title:b.title,reportId:'Deneme · Yayımlanmadı',date:new Date().toLocaleDateString('tr-TR',{timeZone:'Europe/Istanbul'})})}
      } else {
        const suggested=await suggestTemplate(measuredModel,modelName,b.definition,b.mode,b.instruction,b.conversation)
        usage=suggested.usage;result={definition:suggested.definition,...('componentId' in suggested?{componentId:suggested.componentId}:{})}
      }
      await prisma.templateAiRequest.update({where:{id:job.id},data:{status:'COMPLETED',result:result as Prisma.InputJsonValue,usage:usage as Prisma.InputJsonValue}})
      return result
    } catch(error) {
      await prisma.templateAiRequest.update({where:{id:job.id},data:{status:'FAILED',error:error instanceof Error?error.message:'AI işlemi başarısız.'}})
      return reply.code(422).send({message:error instanceof TemplateGenerationError || error instanceof AiProviderError?error.message:'AI önerisi tamamlanamadı veya doğrulanamadı. Çalışmanız korundu; yeniden deneyebilirsiniz.'})
    }
  })
}
