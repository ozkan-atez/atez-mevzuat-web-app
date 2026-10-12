import { DOCUMENT_MAX_BYTES, extensions } from '../documents/domain/document-content'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { getActorContext, documentAccessWhere } from '../../platform/actor-context'
import { ensureWorkspaceCatalog, scanSupported } from '../workspace/catalog'
import { normalizeManagedSourceUrl } from './fetch-managed-source'
import { encryptLogin, sourceLogin } from './source-secrets'
import { sourceAccessWhere, sourceCredentialWorkspace, templateAccessWhere, sourceProfileAccessWhere } from './source-access'
import { enqueueSourceSetup } from './source-setup'
const bindingSchema=z.object({templateId:z.string().min(1),sectionId:z.string().min(1),role:z.enum(['PRIMARY','SUPPORTING']).default('SUPPORTING'),required:z.boolean().default(false),instruction:z.string().max(2000).default(''),datePolicy:z.enum(['PUBLISHED_DATE','NEW_OR_CHANGED']).default('PUBLISHED_DATE')})
const sourceSchema=z.object({name:z.string().trim().min(1).max(200),key:z.string().max(120).optional(),kind:z.enum(['WEB','FILES']).default('WEB'),description:z.string().max(2000).nullable().optional(),baseUrl:z.string().default(''),authorityType:z.enum(['OFFICIAL','REFERENCE','COMMERCIAL','PROFESSIONAL','UNVERIFIED']).default('REFERENCE'),isActive:z.boolean().default(true),username:z.string().max(300).optional(),password:z.string().max(1000).optional(),documentVersionIds:z.array(z.string().min(1)).max(100).default([]),bindings:z.array(bindingSchema).max(100).default([])})
export async function sourceWorkflowRoutes(app:FastifyInstance,{prisma}:{prisma:PrismaClient}) {
  app.get('/api/v1/sources/capabilities',async()=>({maxBytes:DOCUMENT_MAX_BYTES,extensions:Object.keys(extensions),htmlViaUrlOnly:true}))
  app.get('/api/v1/sources',async()=>{
    await ensureWorkspaceCatalog(prisma)
    const sources=await prisma.source.findMany({where:sourceAccessWhere(),orderBy:{createdAt:'asc'},include:{setupJobs:{where:{workspaceId:getActorContext()?.workspaceId??null},orderBy:{createdAt:'desc'},take:1},endpoints:true,profiles:{where:sourceProfileAccessWhere(),select:{status:true}},credentials:{where:{workspaceId:sourceCredentialWorkspace()},select:{id:true}},collectionDocuments:{where:{documentVersion:{document:documentAccessWhere()}},include:{documentVersion:{include:{document:{select:{title:true}}}}}},templateBindings:{where:{template:templateAccessWhere()},include:{template:{select:{name:true,sections:true}}}}}})
    return {sources:sources.map(s=>({...s,...(s.workspaceId===null&&s.setupJobs[0]?{setupStatus:['QUEUED','RUNNING'].includes(s.setupJobs[0].status)?'PREPARING':s.setupJobs[0].status==='COMPLETED'?'READY':(s.setupJobs[0].result as {setupStatus?:string})?.setupStatus??'FAILED',lastTestAt:s.setupJobs[0].updatedAt,lastTestResult:(s.setupJobs[0].result as {message?:string})?.message??null}:{}),setupJobs:undefined,credentials:undefined,name:s.name||s.key,scanSupported:s.kind==='WEB'&&s.setupStatus==='READY'&&scanSupported(s),documentVersionIds:s.collectionDocuments.map(d=>d.documentVersionId),documents:s.collectionDocuments.map(d=>({id:d.documentVersionId,title:d.documentVersion.document.title,status:d.documentVersion.extractionStatus})),collectionDocuments:undefined,bindings:s.templateBindings.map(b=>({...b,template:undefined,templateName:b.template.name,invalid:!(b.template.sections as Array<{id:string}>).some(section=>section.id===b.sectionId)})),templateBindings:undefined}))}
  })
  const save=async(r:any,reply:any,create:boolean)=>{
    const parsed=sourceSchema.safeParse(r.body)
    if(!parsed.success)return reply.code(400).send({message:'Kaynak adı, adresi ve belge seçimini kontrol edin.',issues:parsed.error.issues})
    const data=parsed.data,actor=getActorContext()
    const original=create?null:await prisma.source.findFirst({where:{id:r.params.id,...sourceAccessWhere()}})
    if(!create&&!original)return reply.code(404).send({message:'Kaynak bulunamadı.'})
    // Shared built-ins retain their global identity; tenant-specific credentials remain encrypted per workspace.
    const clone=Boolean(original&&actor&&original.workspaceId===null)
    const id=!clone&&original?original.id:randomUUID()
    let baseUrl=''
    try{baseUrl=data.kind==='WEB'?normalizeManagedSourceUrl(data.baseUrl):`urn:atez:files:${id}`}catch{return reply.code(400).send({message:'Geçerli bir HTTPS kaynak bağlantısı girin.'})}
    if(data.kind==='FILES'&&!data.documentVersionIds.length)return reply.code(400).send({message:'Dosya kaynağı için en az bir belge seçin.'})
    const versions=await prisma.documentVersion.findMany({where:{id:{in:data.documentVersionIds},document:documentAccessWhere()},select:{id:true,extractionStatus:true}})
    if(versions.length!==new Set(data.documentVersionIds).size)return reply.code(404).send({message:'Seçilen belgelerden birine erişilemiyor.'})
    for(const binding of data.bindings){const template=await prisma.reportTemplate.findFirst({where:{id:binding.templateId,...templateAccessWhere()}});if(!template||!(template.sections as Array<{id:string}>).some(section=>section.id===binding.sectionId))return reply.code(400).send({message:'Şablon bölümü değişti. Kaynak bağlantısını yeniden seçin.'})}
    let encrypted:string|undefined
    if(data.username||data.password){if(!data.username||!data.password)return reply.code(400).send({message:'Kullanıcı adı ve parolayı birlikte girin.'});try{encrypted=encryptLogin({username:data.username,password:data.password},id,sourceCredentialWorkspace())}catch{return reply.code(503).send({message:'Hesap şifreleme anahtarı yapılandırılmamış.'})}}
    if(clone&&original&&!encrypted){
      try{const login=await sourceLogin(prisma,original.id,original.key);if(login)encrypted=encryptLogin(login,id,sourceCredentialWorkspace())}catch{return reply.code(503).send({message:'Kayıtlı hesap güvenli biçimde taşınamadı. Hesap bilgilerini yeniden girin.'})}
    }
    const values={name:data.name,description:data.description??null,baseUrl,kind:data.kind,authorityType:data.authorityType,isActive:data.isActive}
    const source=await prisma.$transaction(async tx=>{
      const row=create||clone?await tx.source.create({data:{...values,id,key:`source-${randomUUID()}`,workspaceId:actor?.workspaceId??null,setupStatus:data.kind==='FILES'?'READY':'PREPARING'}}):await tx.source.update({where:{id},data:values})
      await tx.sourceDocument.deleteMany({where:{sourceId:id}})
      if(versions.length)await tx.sourceDocument.createMany({data:versions.map(v=>({sourceId:id,documentVersionId:v.id}))})
      await tx.sourceTemplateBinding.deleteMany({where:{sourceId:id}})
      if(data.bindings.length)await tx.sourceTemplateBinding.createMany({data:data.bindings.map(b=>({...b,sourceId:id}))})
      if(encrypted)await tx.sourceCredential.upsert({where:{sourceId_workspaceId:{sourceId:id,workspaceId:sourceCredentialWorkspace()}},create:{sourceId:id,workspaceId:sourceCredentialWorkspace(),encrypted},update:{encrypted,status:'UNTESTED',testedAt:null}})
      return row
    })
    if(clone&&original?.baseUrl===baseUrl){
      const {builtinProfile}=await import('./source-profile')
      const profile=await prisma.sourceProfile.findFirst({where:{sourceId:original.id,status:'VERIFIED',...sourceProfileAccessWhere()},orderBy:{version:'desc'}})
      const config=profile?.config??builtinProfile(original.key)
      if(config)await prisma.sourceProfile.create({data:{sourceId:id,workspaceId:actor?.workspaceId??null,version:1,status:'VERIFIED',config:config as Prisma.InputJsonValue,verifiedAt:new Date()}})
    }
    if(data.kind==='WEB'&&(create||clone||encrypted||original?.baseUrl!==baseUrl))await enqueueSourceSetup(prisma,id,clone&&original?.baseUrl===baseUrl?'TEST':'SETUP')
    if(data.kind==='FILES')await prisma.source.update({where:{id},data:{setupStatus:versions.every(v=>['EXTRACTED','READY'].includes(v.extractionStatus))?'READY':'FAILED',lastTestAt:new Date(),lastTestResult:versions.every(v=>['EXTRACTED','READY'].includes(v.extractionStatus))?'Belgeler okunabilir.':'Bazı belgelerin metni henüz okunamadı.'}})
    return reply.code(create?201:200).send(source)
  }
  app.post('/api/v1/sources',(r,reply)=>save(r,reply,true))
  app.patch('/api/v1/sources/:id',(r,reply)=>save(r,reply,false))
  app.delete('/api/v1/sources/:id',async(r,reply)=>{const {id}=r.params as {id:string};const found=await prisma.source.updateMany({where:{id,workspaceId:getActorContext()?.workspaceId??null},data:{isActive:false}});return found.count?reply.code(204).send():reply.code(404).send({message:'Kaynak bulunamadı.'})})
  app.post('/api/v1/sources/:id/test',async(r,reply)=>{
    const {id}=r.params as {id:string};const source=await prisma.source.findFirst({where:{id,...sourceAccessWhere()}})
    if(!source)return reply.code(404).send({message:'Kaynak bulunamadı.'})
    if(source.kind==='FILES')return reply.code(400).send({message:'Dosya kaynaklarında belgelerin okunabilirlik durumu gösterilir.'})
    return reply.code(202).send(await enqueueSourceSetup(prisma,id,source.setupStatus==='READY'?'TEST':'SETUP'))
  })
}
