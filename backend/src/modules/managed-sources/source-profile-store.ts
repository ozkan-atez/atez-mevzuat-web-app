import { Prisma, type PrismaClient } from '@prisma/client'
import { isDeepStrictEqual } from 'node:util'
import { builtinProfile, sourceProfileSchema } from './source-profile'
// Upgrade only the exact shipped profile; never replace user-defined feed rules.
export function expandedTicaretProfile(key:string, config:unknown) {
  if(key!=='ticaret-bakanligi')return null
  const expanded=builtinProfile(key)!
  const legacy={...expanded,maxDocuments:100,feeds:expanded.feeds.slice(0,2),allowedHosts:expanded.allowedHosts.filter(host=>!['tagm.ticaret.gov.tr','personel.ticaret.gov.tr','ithalat.ticaret.gov.tr'].includes(host))}
  const parsed=sourceProfileSchema.safeParse(config)
  if(!parsed.success)return null
  // The first saved release predated titleSelector and the shared reference hosts.
  const initialFeeds=legacy.feeds.map(feed=>{const {titleSelector,...original}=feed;return original})
  const versions=[legacy,{...legacy,feeds:initialFeeds},{...legacy,allowedHosts:['ticaret.gov.tr','www.ticaret.gov.tr','ggm.ticaret.gov.tr']},{...legacy,feeds:initialFeeds,allowedHosts:['ticaret.gov.tr','www.ticaret.gov.tr','ggm.ticaret.gov.tr']}]
  return versions.some(version=>isDeepStrictEqual(parsed.data,version))?expanded:null
}
export async function activeSourceProfile(prisma:PrismaClient,source:{id:string;key:string}) {
  const saved=await prisma.sourceProfile.findFirst({where:{sourceId:source.id,status:'VERIFIED'},orderBy:{version:'desc'}})
  if(saved){
    const expanded=expandedTicaretProfile(source.key,saved.config)
    if(expanded){
      const latest=await prisma.sourceProfile.findFirst({where:{sourceId:source.id},orderBy:{version:'desc'}})
      const version=(latest?.version??saved.version)+1
      const upgraded=await prisma.sourceProfile.upsert({where:{sourceId_version:{sourceId:source.id,version}},create:{sourceId:source.id,version,status:'VERIFIED',config:expanded as unknown as Prisma.InputJsonValue,verifiedAt:new Date(),validation:{kind:'ticaret-multi-feed',notes:'Haber, duyuru, ekonomi, ürün güvenliği ve ithalat listeleri 14.10.2026 tarihinde incelendi.'}},update:{}})
      return {id:upgraded.id,version:upgraded.version,config:sourceProfileSchema.parse(upgraded.config)}
    }
    return {id:saved.id,version:saved.version,config:sourceProfileSchema.parse(saved.config)}
  }
  const config=builtinProfile(source.key)
  if(!config)throw new Error('PROFILE_REQUIRED: Bu kaynak için doğrulanmış tarama profili gerekli.')
  const seed=await prisma.sourceProfile.upsert({where:{sourceId_version:{sourceId:source.id,version:1}},create:{sourceId:source.id,version:1,status:'VERIFIED',config:config as unknown as Prisma.InputJsonValue,verifiedAt:new Date('2026-10-11T15:00:00+03:00'),validation:{kind:'browser-inspection',notes:'Liste ve erişim yapısı incelendi. Hesap gerektiren ayrıntıların erişimi ayrıca test edilir.'}},update:{}})
  if(seed.status!=='VERIFIED')throw new Error('PROFILE_REQUIRED: Kaynak profili doğrulanmayı bekliyor.')
  return {id:seed.id,version:seed.version,config:sourceProfileSchema.parse(seed.config)}
}
