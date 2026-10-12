export interface LegacyActivityRow {id:string;updatedAt:Date}
export interface LegacyActivityModel {
 findMany(input:unknown):Promise<LegacyActivityRow[]>
 updateMany(input:unknown):Promise<{count:number}>
}
/** Ownership is metadata, not user activity. Preserve ordering and use CAS to avoid overwriting concurrent edits. */
export async function assignMetadataPreservingActivity(model:LegacyActivityModel,where:Record<string,unknown>,metadata:Record<string,unknown>,pageSize=100){
 let cursor:string|undefined,updated=0,skipped=0
 for(;;){
  const rows=await model.findMany({where:{AND:[where,...(cursor?[{id:{gt:cursor}}]:[])]},orderBy:{id:'asc'},take:pageSize,select:{id:true,updatedAt:true}})
  if(!rows.length)break
  for(const row of rows){
   const changed=await model.updateMany({where:{...where,id:row.id,updatedAt:row.updatedAt},data:{...metadata,updatedAt:row.updatedAt}})
   if(changed.count)updated+=changed.count;else skipped++
  }
  cursor=rows.at(-1)!.id
 }
 return {updated,skipped}
}
