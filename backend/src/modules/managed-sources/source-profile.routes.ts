import { enqueueSourceSetup } from './source-setup'
import { sourceAccessWhere, sourceCredentialWorkspace, sourceProfileAccessWhere } from './source-access'
import { discoverProfile } from './profile-discovery'
import { getActorContext } from '../../platform/actor-context'
import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { sourceProfileSchema, builtinProfile } from './source-profile'
import { activeSourceProfile } from './source-profile-store'
import { encryptLogin, sourceLogin } from './source-secrets'
import { openSourceSession } from './source-session'
import { collectSource } from './source-collector'
/** Until deployment OIDC is supplied, secrets may only be managed by this local installation's owner. */
export function sourceAdminAllowed(request:Pick<FastifyRequest,'headers'|'ip'|'method'>,admin=process.env.SOURCE_ADMIN_BEARER):boolean {
  const actor = getActorContext()
  if (actor) return actor.permissions.includes('config.manage')
  if(admin){const actual=Buffer.from(String(request.headers.authorization??''));const expected=Buffer.from(`Bearer ${admin}`);return actual.length===expected.length&&timingSafeEqual(actual,expected)}
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.ip))return false
  const origin=request.headers.origin
  if(origin&&!['http://localhost:8888','http://127.0.0.1:8888','http://localhost:5173','http://127.0.0.1:5173'].includes(origin))return false
  if(request.headers['sec-fetch-site']==='cross-site')return false
  return request.method==='GET'||request.headers['x-source-intent']==='manage'
}
export async function sourceProfileRoutes(app:FastifyInstance,{prisma}:{prisma:PrismaClient}) {
  app.addHook('preHandler',async(request,reply)=>{if(!sourceAdminAllowed(request))return reply.code(403).send({message:'Kaynak hesap ve profil yönetimi yalnızca yetkili yöneticiye açıktır.'})})
  app.get('/:id',async(request,reply)=>{
    const {id}=request.params as {id:string};const source=await prisma.source.findFirst({where:{id,...sourceAccessWhere()}});if(!source)return reply.code(404).send({message:'Kaynak bulunamadı.'})
    const profiles=await prisma.sourceProfile.findMany({where:{sourceId:id,...sourceProfileAccessWhere()},orderBy:{version:'desc'}})
    const credential=await prisma.sourceCredential.findUnique({where:{sourceId_workspaceId:{sourceId:id,workspaceId:sourceCredentialWorkspace()}},select:{status:true,testedAt:true,updatedAt:true}})
    return {profiles, suggested:builtinProfile(source.key),credential,observations:await prisma.sourceObservation.findMany({where:{sourceId:id,scope:'inventory',publishedOn:null},select:{title:true,url:true,firstSeenAt:true},take:30,orderBy:{lastSeenAt:'desc'}})}
  })
  app.post('/:id/discover',async(request,reply)=>{
    const {id}=request.params as {id:string};const source=await prisma.source.findFirst({where:{id,...sourceAccessWhere()}});if(!source)return reply.code(404).send({message:'Kaynak bulunamadı.'})
    try {const result=await discoverProfile(source);const latest=await prisma.sourceProfile.findFirst({where:{sourceId:id},orderBy:{version:'desc'}});return await prisma.sourceProfile.create({data:{sourceId:id,workspaceId:getActorContext()?.workspaceId??null,version:(latest?.version??0)+1,config:result.config as unknown as Prisma.InputJsonValue,validation:result.evidence as Prisma.InputJsonValue}})}catch(error){return reply.code(422).send({message:error instanceof Error?error.message:'Keşif tamamlanamadı.'})}
  })
  app.put('/:id/credentials',async(request,reply)=>{
    const {id}=request.params as {id:string};const login=z.object({username:z.string().trim().min(1).max(300),password:z.string().min(1).max(1000)}).safeParse(request.body)
    if(!login.success)return reply.code(400).send({message:'Kullanıcı adı ve parola gerekli.'})
    if(!await prisma.source.findFirst({where:{id,...sourceAccessWhere()}}))return reply.code(404).send({message:'Kaynak bulunamadı.'})
    try {const encrypted=encryptLogin(login.data,id,sourceCredentialWorkspace());await prisma.sourceCredential.upsert({where:{sourceId_workspaceId:{sourceId:id,workspaceId:sourceCredentialWorkspace()}},create:{sourceId:id,workspaceId:sourceCredentialWorkspace(),encrypted},update:{encrypted,status:'UNTESTED',testedAt:null}});await enqueueSourceSetup(prisma,id);return {saved:true,status:'UNTESTED'}}catch{return reply.code(503).send({message:'Hesap şifrelenemedi; şifreleme anahtarı kurulmalı.'})}
  })
  app.post('/:id/credentials/test',async(request,reply)=>{
    const {id}=request.params as {id:string};let session:Awaited<ReturnType<typeof openSourceSession>>|undefined
    try {
      const source=await prisma.source.findFirstOrThrow({where:{id,...sourceAccessWhere()}});const {config}=await activeSourceProfile(prisma,source);const login=await sourceLogin(prisma,id,source.key)
      session=await openSourceSession(config,login)
      if(config.transport==='TARIFF_API')await collectSource({...config,maxPages:1,maxDocuments:3},new Date().toISOString().slice(0,10),session,login)
      else if(config.feeds[0])await session.html(config.feeds[0].url)
      await prisma.sourceCredential.updateMany({where:{sourceId:id,workspaceId:sourceCredentialWorkspace()},data:{status:'READY',testedAt:new Date()}})
      return {status:'READY',message:'Kaynak bağlantısı doğrulandı.'}
    }catch(error){await prisma.sourceCredential.updateMany({where:{sourceId:id,workspaceId:sourceCredentialWorkspace()},data:{status:'ATTENTION',testedAt:new Date()}});return reply.code(422).send({message:error instanceof Error?error.message:'Kaynak bağlantısı doğrulanamadı.'})}finally{await session?.close()}
  })
  app.post('/:id/profiles',async(request,reply)=>{
    const {id}=request.params as {id:string};const parsed=sourceProfileSchema.safeParse(request.body)
    if(!parsed.success)return reply.code(400).send({message:parsed.error.issues[0]?.message??'Profil geçersiz.'})
    const source=await prisma.source.findFirst({where:{id,...sourceAccessWhere()}});if(!source)return reply.code(404).send({message:'Kaynak bulunamadı.'})
    const latest=await prisma.sourceProfile.findFirst({where:{sourceId:id},orderBy:{version:'desc'}})
    try{return await prisma.sourceProfile.create({data:{sourceId:id,workspaceId:getActorContext()?.workspaceId??null,version:(latest?.version??0)+1,config:parsed.data as unknown as Prisma.InputJsonValue}})}catch{return reply.code(409).send({message:'Profil eşzamanlı güncellendi; yeniden yükleyin.'})}
  })
  app.post('/:id/profiles/:profileId/verify',async(request,reply)=>{
    const {id,profileId}=request.params as {id:string;profileId:string};let session:Awaited<ReturnType<typeof openSourceSession>>|undefined
    const profile=await prisma.sourceProfile.findFirst({where:{id:profileId,sourceId:id,source:sourceAccessWhere(),...sourceProfileAccessWhere()},include:{source:true}});if(!profile)return reply.code(404).send({message:'Profil bulunamadı.'})
    try {
      const config=sourceProfileSchema.parse(profile.config);const login=await sourceLogin(prisma,id,profile.source.key);session=await openSourceSession(config,login)
      if(config.transport==='GAZETTE'&&profile.source.key!=='resmi-gazete')throw new Error('Resmî Gazete bağlayıcısı yalnızca kendi kaynağında kullanılabilir.')
      const result=config.transport==='GAZETTE'?{pages:[],items:[],warnings:[],observed:0}:await collectSource({...config,maxPages:2,maxDocuments:30},new Date().toISOString().slice(0,10),session,login,'NEW_OR_CHANGED')
      if(config.transport!=='GAZETTE'&&config.transport!=='TARIFF_API'&&!result.items.length)throw new Error('Liste yapısından doğrulanabilir kayıt çıkarılamadı.')
      if(result.warnings.some(w=>/AUTH_REQUIRED|USER_ACTION_REQUIRED|SUBSCRIPTION_REQUIRED|okunamadı|bulunamadı|doğrulanamadı/.test(w)))throw new Error(result.warnings.join('; ').slice(0,1000))
      const sample=result.items[0];if(sample&&config.transport!=='TARIFF_API')await session.binary(sample.url,4_000_000)
      const validation={checkedAt:new Date().toISOString(),pages:result.pages,observed:result.observed,warnings:result.warnings,samples:result.items.slice(0,3).map(i=>({title:i.title,url:i.url,publishedOn:i.publishedOn}))}
      await prisma.sourceProfile.update({where:{id:profileId},data:{status:'VERIFIED',verifiedAt:new Date(),validation:validation as Prisma.InputJsonValue}})
      return {status:'VERIFIED',validation}
    }catch(error){const message=error instanceof Error?error.message:'Profil doğrulanamadı.';await prisma.sourceProfile.update({where:{id:profileId},data:{status:'NEEDS_REVIEW',validation:{message,checkedAt:new Date().toISOString()}}});return reply.code(422).send({message})}finally{await session?.close()}
  })
}
