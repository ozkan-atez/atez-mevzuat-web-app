import { Prisma, type PrismaClient } from '@prisma/client'
import { builtinProfile, sourceProfileSchema } from './source-profile'
export async function activeSourceProfile(prisma:PrismaClient,source:{id:string;key:string}) {
  const saved=await prisma.sourceProfile.findFirst({where:{sourceId:source.id,status:'VERIFIED'},orderBy:{version:'desc'}})
  if(saved)return {id:saved.id,version:saved.version,config:sourceProfileSchema.parse(saved.config)}
  const config=builtinProfile(source.key)
  if(!config)throw new Error('PROFILE_REQUIRED: Bu kaynak için doğrulanmış tarama profili gerekli.')
  const seed=await prisma.sourceProfile.upsert({where:{sourceId_version:{sourceId:source.id,version:1}},create:{sourceId:source.id,version:1,status:'VERIFIED',config:config as unknown as Prisma.InputJsonValue,verifiedAt:new Date('2026-10-11T15:00:00+03:00'),validation:{kind:'browser-inspection',notes:'Liste ve erişim yapısı incelendi. Hesap gerektiren ayrıntıların erişimi ayrıca test edilir.'}},update:{}})
  if(seed.status!=='VERIFIED')throw new Error('PROFILE_REQUIRED: Kaynak profili doğrulanmayı bekliyor.')
  return {id:seed.id,version:seed.version,config:sourceProfileSchema.parse(seed.config)}
}
