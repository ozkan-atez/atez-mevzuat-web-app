import { Prisma, type PrismaClient } from '@prisma/client'
import { templateHtml } from './report-template-catalog'
const json=(v:unknown)=>v as Prisma.InputJsonValue
export async function studioRequest<T>(base:string,path:string,body?:unknown):Promise<T>{
 const response=await fetch(`${base.replace(/\/$/,'')}${path}`,{...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(180000),redirect:'error'})
 if(!response.ok)throw new Error('Şablon stüdyosu işlemi tamamlanamadı.')
 return response.json() as Promise<T>
}
export async function syncStudioTemplates(prisma:PrismaClient,base:string){
 const rows=await studioRequest<Array<{id:string;title:string;isDefault:boolean;currentVersion:number;description?:string}>>(base,'/api/templates')
 const snapshots=await Promise.all(rows.map(t=>studioRequest<Record<string,unknown>&{definition:{sections:Array<{id:string;heading:string;enabled:boolean}>}}>(base,`/integration/templates/${t.id}`)))
 await prisma.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('v2-studio-template-sync'))`
  if(rows.some(t=>t.isDefault))await tx.reportTemplate.updateMany({where:{isDefault:true},data:{isDefault:false}})
  for(const [i,t] of rows.entries()){
   const data={name:t.title,description:t.description??'',isActive:true,isDefault:t.isDefault,revision:t.currentVersion,studioSnapshot:json(snapshots[i]),definition:Prisma.DbNull,html:templateHtml,sections:snapshots[i]!.definition.sections.map(s=>({...s,html:''}))}
   await tx.reportTemplate.upsert({where:{id:t.id},create:{id:t.id,...data},update:data})
  }
  await tx.reportTemplate.updateMany({where:{studioSnapshot:{not:Prisma.DbNull},id:{notIn:rows.map(t=>t.id)}},data:{isActive:false,isDefault:false}})
 })
}
