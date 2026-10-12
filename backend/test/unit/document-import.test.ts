import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { importDocument } from '../../src/modules/documents/application/import-document'
import { readableDocumentVersions, extractDocumentVersion } from '../../src/modules/documents/application/extract-document'

function fakeArchive(){
  const imports:any[]=[];const documents:any[]=[];const versions:any[]=[];const blobs:any[]=[]
  const objects=new Map<string,Buffer>()
  let transaction=Promise.resolve()
  const prisma:any={
    documentImport:{findUnique:vi.fn(async({where}:any)=>{const row=imports.find(r=>r.actorScope===where.actorScope_idempotencyKey.actorScope && r.idempotencyKey===where.actorScope_idempotencyKey.idempotencyKey);return row?{...row,documentVersion:versions.find(v=>v.id===row.documentVersionId)??null}:null}),create:vi.fn(async({data}:any)=>{const row={...data,id:`i${imports.length}`,createdAt:new Date(),updatedAt:new Date()};imports.push(row);return row}),update:vi.fn(async({where,data}:any)=>Object.assign(imports.find(r=>r.id===where.id),data,{updatedAt:new Date()})),updateMany:vi.fn(async({where,data}:any)=>{const row=imports.find(r=>r.id===where.id&&r.status===where.status&&r.updatedAt===where.updatedAt);if(!row)return {count:0};Object.assign(row,data);return {count:1}})},
    document:{findFirst:vi.fn(async({where}:any)=>documents.find(d=>d.actorScope===where.actorScope && (!where.id||where.id===d.id)&&(!where.versions||versions.some(v=>v.documentId===d.id&&v.contentHash===where.versions.some.contentHash)))??null),create:vi.fn(async({data}:any)=>{const row={...data,id:`d${documents.length}`,createdAt:new Date()};documents.push(row);return row})},
    storedObject:{findUnique:vi.fn(async({where}:any)=>blobs.find(r=>r.sha256===where.sha256)??null),upsert:vi.fn(async({create}:any)=>{let row=blobs.find(r=>r.sha256===create.sha256);if(!row){row={...create,id:`b${blobs.length}`};blobs.push(row)}return row})},
    documentVersion:{upsert:vi.fn(async({create}:any)=>{let row=versions.find(v=>v.documentId===create.documentId&&v.contentHash===create.contentHash);if(!row){row={...create,id:`v${versions.length}`,createdAt:new Date(),document:documents.find(d=>d.id===create.documentId),storedObject:blobs.find(b=>b.id===create.storedObjectId)};versions.push(row)}return row}),findFirst:vi.fn(async({where}:any)=>versions.find(v=>v.id===where.id&&v.document.actorScope===where.document.actorScope)??null),findUniqueOrThrow:vi.fn(async({where}:any)=>versions.find(v=>v.id===where.id)),update:vi.fn(async({where,data}:any)=>Object.assign(versions.find(v=>v.id===where.id),data)),findMany:vi.fn(async({where}:any)=>versions.filter(v=>where.id.in.includes(v.id)&&v.document.actorScope===where.document.actorScope))},
    $executeRaw:vi.fn(async()=>1),$transaction:async(fn:any)=>{const prior=transaction;let done!:()=>void;transaction=new Promise<void>(resolve=>{done=resolve});await prior;try{return await fn(prisma)}finally{done()}}
  }
  const store={getContent:vi.fn(async(key:string)=>objects.get(key)!),putRunFile:vi.fn(async(key:string,bytes:Buffer,mediaType:string)=>{objects.set(key,bytes);return {bucket:'test',objectKey:key,byteSize:BigInt(bytes.length),mediaType,sha256:'hash'}})}
  return {prisma:prisma as PrismaClient,store,imports,documents,versions,blobs}
}
describe('scoped immutable document imports',()=>{
  it('same upload reuses physical bytes and logical version; no AI or scraping',async()=>{
    const archive=fakeArchive();const input={bytes:Buffer.from('Customs data'),filename:'file.txt',actorScope:'workspace'}
    const first=await importDocument({prisma:archive.prisma,objectStore:archive.store},{...input,idempotencyKey:'one'})
    const next=await importDocument({prisma:archive.prisma,objectStore:archive.store},{...input,idempotencyKey:'two'})
    expect(next.version.id).toBe(first.version.id);expect(next.import.status).toBe('READY');expect(archive.store.putRunFile).toHaveBeenCalledTimes(1);expect(archive.documents).toHaveLength(1)
    await expect(importDocument({prisma:archive.prisma,objectStore:archive.store},{...input,title:'changed',idempotencyKey:'one'})).rejects.toMatchObject({statusCode:409})
  })
  it('concurrent identical bytes serialize logical creation',async()=>{
    const archive=fakeArchive();const input={bytes:Buffer.from('Concurrent file'),filename:'file.txt',actorScope:'workspace'}
    const result=await Promise.all(['a','b'].map(idempotencyKey=>importDocument({prisma:archive.prisma,objectStore:archive.store},{...input,idempotencyKey})))
    expect(result[0]?.version.id).toBe(result[1]?.version.id);expect(archive.documents).toHaveLength(1);expect(archive.blobs).toHaveLength(1)
  })
  it('a failed storage import can resume with same key',async()=>{
    const archive=fakeArchive();const input={bytes:Buffer.from('Retry data'),filename:'file.txt',actorScope:'workspace',idempotencyKey:'retry'}
    archive.store.putRunFile.mockRejectedValueOnce(new Error('storage down'))
    await expect(importDocument({prisma:archive.prisma,objectStore:archive.store},input)).rejects.toThrow('storage down')
    expect(archive.imports[0].status).toBe('FAILED')
    expect((await importDocument({prisma:archive.prisma,objectStore:archive.store},input)).import.status).toBe('READY')
    expect(archive.imports).toHaveLength(1)
  })
  it('failed extraction retains original version and blocks cross scope reads',async()=>{
    const archive=fakeArchive();const result=await importDocument({prisma:archive.prisma,objectStore:archive.store},{bytes:Buffer.from('valid text'),filename:'file.txt',actorScope:'owner'})
    archive.store.getContent.mockRejectedValueOnce(new Error('temporarily unavailable'))
    expect(await extractDocumentVersion({prisma:archive.prisma,objectStore:archive.store},result.version.id,'owner')).toMatchObject({status:'FAILED'})
    expect(archive.blobs).toHaveLength(1)
    await expect(readableDocumentVersions(archive.prisma,[result.version.id],'another')).rejects.toMatchObject({statusCode:404})
  })
})
