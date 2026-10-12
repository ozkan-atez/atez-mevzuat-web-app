import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Prisma, type PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import type { AiModelClient } from '../ai/application/ai-model-client'
import { toGeminiJsonSchema } from '../ai/application/gemini-json-schema'
import { getActorContext } from '../../platform/actor-context'
import { recordUsage } from '../usage/usage'
import { sectionSchema, semanticMarkup } from './template-sections'
export async function templateSuggestionRoutes(app:FastifyInstance,{prisma,aiModel,model}:{prisma:PrismaClient;aiModel:AiModelClient;model:string}) {
  app.post('/api/v1/templates/suggest',async(request,reply)=>{
    const body=z.object({name:z.string().min(1).max(200),description:z.string().max(2000).default(''),sections:z.array(sectionSchema).min(1).max(30),requestKey:z.string().uuid()}).safeParse(request.body)
    if(!body.success)return reply.code(400).send({message:'Şablon adı ve en az bir bölüm açıklaması girin.'})
    const actor=getActorContext(),existing=await prisma.templateSuggestion.findUnique({where:{requestKey:body.data.requestKey}})
    if(existing){if(existing.workspaceId!==(actor?.workspaceId??null)||existing.userId!==(actor?.userId??null))return reply.code(404).send({message:'İstek bulunamadı.'});return existing.status==='COMPLETED'?existing.result:reply.code(409).send({message:existing.status==='RUNNING'?'Öneri hazırlanıyor.':'Önceki öneri tamamlanamadı. Yeniden deneyin.'})}
    const row=await prisma.templateSuggestion.create({data:{requestKey:body.data.requestKey,workspaceId:actor?.workspaceId??null,userId:actor?.userId??null,input:body.data as Prisma.InputJsonValue}})
    const callId=randomUUID(),outputSchema=z.object({sections:z.array(sectionSchema.omit({html:true})).min(1).max(30)})
    await recordUsage(prisma,{callId,category:'TEMPLATE_GENERATION',model,status:'RUNNING'})
    try{
      const result=await aiModel.generateStructured({model,systemInstruction:'Rapor şablonu yapısı öner. Kullanıcı başlıklarını, anlamını, mevcut bölüm kimliklerini ve gereksinimlerini koru. Yeni bölüm ekleme, bölüm silme. Açıklamaları netleştir; yalnız izinli componentType kullan. Gerçek araştırma sonucu, HTML veya mevzuat iddiası üretme. Her bölüm schemaVersion 2 olmalı.',parts:[{text:JSON.stringify(body.data)}],responseJsonSchema:toGeminiJsonSchema(z.toJSONSchema(outputSchema, {unrepresentable:'any'}))})
      const proposed=outputSchema.parse(result.json)
      if(proposed.sections.length!==body.data.sections.length||new Set(proposed.sections.map(s=>s.id)).size!==body.data.sections.length||proposed.sections.some(s=>!body.data.sections.some(original=>original.id===s.id)))throw new Error('Bölüm kimlikleri korunmadı.')
      const response={sections:proposed.sections.map((s,order)=>({...s,html:semanticMarkup,schemaVersion:2,order})),suggestionId:row.id}
      await prisma.templateSuggestion.update({where:{id:row.id},data:{status:'COMPLETED',result:response,inputTokens:result.usage.inputTokens,outputTokens:result.usage.outputTokens,providerRequestId:result.providerRequestId}})
      await recordUsage(prisma,{callId,category:'TEMPLATE_GENERATION',model,status:'COMPLETED',...result.usage})
      return response
    }catch(error){await prisma.templateSuggestion.update({where:{id:row.id},data:{status:'FAILED',error:'Öneri oluşturulamadı.'}});await recordUsage(prisma,{callId,category:'TEMPLATE_GENERATION',model,status:'FAILED',...(error&&typeof error==='object'&&'usage' in error?error.usage as import('../ai/application/ai-model-client').StructuredAiResult['usage']:{})});return reply.code(502).send({message:'AI önerisi oluşturulamadı. Bölümleri elle düzenleyip kaydedebilirsiniz.'})}
  })
}
