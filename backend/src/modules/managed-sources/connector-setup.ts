import { Prisma, type PrismaClient } from '@prisma/client'
import { builtinProfile, sourceProfileSchema, assertContentAccess } from './source-profile'
import { discoverProfile } from './profile-discovery'
import { openSourceSession } from './source-session'
import { collectSource } from './source-collector'
import { sourceLogin } from './source-secrets'
import { BackgroundTaskError } from '../../platform/background-error'
import { connectorQueueName } from '../../platform/rabbitmq'

const pending = ['SETUP_QUEUED', 'SETUP_RUNNING']
export async function queueConnectorTest(prisma: PrismaClient, sourceId: string) {
  return prisma.$transaction(async tx => {
    // Serialize setup requests per source, including requests from different API processes.
    await tx.$queryRaw`SELECT id FROM "Source" WHERE id = ${sourceId} FOR UPDATE`
    const latest = await tx.sourceProfile.findFirst({where:{sourceId},orderBy:{version:'desc'}})
    if (latest && pending.includes(latest.status)) return latest
    const source = await tx.source.findUniqueOrThrow({where:{id:sourceId}})
    return tx.sourceProfile.create({data:{sourceId,version:(latest?.version??0)+1,status:'SETUP_QUEUED',config:latest?.config ?? builtinProfile(source.key) as unknown as Prisma.InputJsonValue ?? {},validation:{message:'Bağlantı kontrolü sırada.',queuedAt:new Date().toISOString()}}})
  })
}
export async function dispatchConnectorTests(prisma: PrismaClient, queue: {send(name:string,data:unknown,options:{singletonKey:string}):Promise<unknown>}) {
  const rows = await prisma.sourceProfile.findMany({where:{status:'SETUP_QUEUED'},take:50,orderBy:{createdAt:'asc'}})
  for(const row of rows) {
    const validation = (row.validation ?? {}) as Record<string,unknown>
    if(typeof validation.dispatchedAt==='string' && Date.now()-Date.parse(validation.dispatchedAt)<60_000) continue
    await queue.send(connectorQueueName,{profileId:row.id},{singletonKey:`connector:${row.id}`})
    await prisma.sourceProfile.updateMany({where:{id:row.id,status:'SETUP_QUEUED'},data:{validation:{...validation,dispatchedAt:new Date().toISOString()} as Prisma.InputJsonValue}})
  }
}
export async function executeConnectorTest(prisma: PrismaClient, profileId: string) {
  const profile=await prisma.sourceProfile.findUniqueOrThrow({where:{id:profileId},include:{source:true}})
  if(['VERIFIED','NEEDS_REVIEW'].includes(profile.status))return
  await prisma.sourceProfile.update({where:{id:profileId},data:{status:'SETUP_RUNNING'}})
  let session:Awaited<ReturnType<typeof openSourceSession>>|undefined
  try {
    const parsed=sourceProfileSchema.safeParse(profile.config)
    const config=parsed.success?parsed.data:(await discoverProfile(profile.source)).config
    const login=await sourceLogin(prisma,profile.sourceId,profile.source.key)
    session=await openSourceSession(config,login)
    let samples:Array<{title:string;url:string}>=[]
    if(config.transport==='GAZETTE') {
      const html=await session.html(profile.source.baseUrl);assertContentAccess(html,profile.source.baseUrl)
      if(!/resm[iî]\s*gazete/i.test(html))throw new Error('Resmî Gazete sayfası doğrulanamadı.')
    } else {
      const result=await collectSource({...config,maxPages:1,maxDocuments:3},new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul'}).format(new Date()),session,login,'NEW_OR_CHANGED')
      if(!result.items.length)throw new Error('Örnek kayıt bulunamadı; liste yapısı veya hesap bilgileri kontrol edilmeli.')
      const failures=result.warnings.filter(w=>!/sınırına ulaşıldı/.test(w))
      if(failures.length)throw new Error(failures.join('; ').slice(0,1000))
      samples=result.items.slice(0,3).map(item=>({title:item.title,url:item.url}))
      if(config.transport!=='TARIFF_API') {
        const sample=await session.binary(samples[0]!.url,config.maxFileBytes??25_000_000)
        if(!sample.body.length)throw new Error('Örnek belge boş.')
        if(/html/i.test(sample.contentType))assertContentAccess(sample.body.toString('utf8'),sample.finalUrl??samples[0]!.url)
      }
    }
    await prisma.sourceProfile.update({where:{id:profileId},data:{status:'VERIFIED',config:config as unknown as Prisma.InputJsonValue,verifiedAt:new Date(),validation:{checkedAt:new Date().toISOString(),message:'Erişim ve örnek içerik kontrol edildi. Ayrıntılı AI analizi tarama sırasında yapılır.',samples}}})
  }catch(error){
    const message=error instanceof Error?error.message:'Bağlantı doğrulanamadı.'
    await prisma.sourceProfile.update({where:{id:profileId},data:{status:'NEEDS_REVIEW',validation:{checkedAt:new Date().toISOString(),message,manualActionRequired:true}}})
    throw new BackgroundTaskError(message,'CONNECTOR_SETUP_FAILED',false,{sourceId:profile.sourceId,profileId,manualActionRequired:true})
  }finally{await session?.close()}
}
