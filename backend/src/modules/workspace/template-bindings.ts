import type { PrismaClient } from '@prisma/client'
import { sourceAccessWhere } from '../managed-sources/source-access'
/** Resolve once at request creation. Workers consume this frozen mapping, never live template edits. */
export async function snapshotTemplateBindings(prisma:PrismaClient,templateId:string,sections:unknown,selectedSourceIds?:string[]) {
 const rows=await prisma.sourceTemplateBinding.findMany({where:{templateId,source:sourceAccessWhere()},include:{source:{include:{collectionDocuments:{include:{documentVersion:{select:{extractionStatus:true}}}}}}}})
 const ids=new Set((Array.isArray(sections)?sections:[]).map(s=>(s as {id:string}).id))
 for(const binding of rows){
   if(!ids.has(binding.sectionId))throw new Error('Kaynak bağlantısındaki bir şablon bölümü değişti. Kaynak bağlamını güncelleyin.')
   if(binding.required&&(!binding.source.isActive||binding.source.setupStatus!=='READY'||selectedSourceIds&&!selectedSourceIds.includes(binding.sourceId)))throw new Error('Şablonun zorunlu kaynağı hazır veya seçili değil.')
   if(binding.required&&binding.source.kind==='FILES'&&binding.source.collectionDocuments.some(d=>!['READY','EXTRACTED'].includes(d.documentVersion.extractionStatus)))throw new Error('Zorunlu kaynaktaki bir belge okunamadı.')
 }
 return rows.filter(binding=>!selectedSourceIds||selectedSourceIds.includes(binding.sourceId)).map(({source,...binding})=>({...binding,sourceName:source.name,sourceKey:source.key,sourceKind:source.kind,documentVersionIds:source.collectionDocuments.map(d=>d.documentVersionId)}))
}
