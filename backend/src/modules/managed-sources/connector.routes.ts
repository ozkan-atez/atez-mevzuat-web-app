import { ensureWorkspaceCatalog } from '../workspace/catalog'
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { normalizeManagedSourceUrl } from './fetch-managed-source'
import { queueConnectorTest } from './connector-setup'
import { encryptLogin } from './source-secrets'

export async function connectorRoutes(app:FastifyInstance,{prisma}:{prisma:PrismaClient}) {
  app.get('/',async()=>{await ensureWorkspaceCatalog(prisma);return {sources:await prisma.source.findMany({orderBy:{createdAt:'asc'},include:{profiles:{orderBy:{version:'desc'},take:1,select:{status:true,verifiedAt:true,validation:true}},credentials:{select:{status:true}}}})}})
  app.post('/',async(request,reply)=>{
    const input=z.object({name:z.string().trim().min(1).max(200),url:z.string().max(2000)}).safeParse(request.body)
    if(!input.success)return reply.code(400).send({message:'Kaynak adı ve bağlantısı gereklidir.'})
    let url:string
    try{url=normalizeManagedSourceUrl(input.data.url)}catch{return reply.code(400).send({message:'Genel internete açık bir HTTPS adresi girin.'})}
    const source=await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${url}))`
      const existing=await tx.source.findFirst({where:{baseUrl:url}})
      return existing??tx.source.create({data:{key:`connector-${randomUUID()}`,name:input.data.name,baseUrl:url,authorityType:'UNVERIFIED'}})
    })
    await queueConnectorTest(prisma,source.id)
    return reply.code(202).send({id:source.id,status:'SETUP_QUEUED'})
  })
  app.post('/:id/test',async(request,reply)=>{
    const {id}=request.params as {id:string}
    if(!await prisma.source.findUnique({where:{id}}))return reply.code(404).send({message:'Kaynak bulunamadı.'})
    const input=z.object({username:z.string().trim().min(1).max(300),password:z.string().min(1).max(1000)}).optional().safeParse(request.body)
    if(!input.success)return reply.code(400).send({message:'Kullanıcı adı ve parola birlikte gereklidir.'})
    if(input.data){
      const encrypted=encryptLogin(input.data,id)
      await prisma.sourceCredential.upsert({where:{sourceId_workspaceId:{sourceId:id,workspaceId:'local'}},create:{sourceId:id,encrypted},update:{encrypted,status:'UNTESTED',testedAt:null}})
    }
    const profile=await queueConnectorTest(prisma,id)
    return reply.code(202).send({id:profile.id,status:profile.status})
  })
}
