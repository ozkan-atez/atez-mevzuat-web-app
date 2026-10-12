import { describe,expect,it,vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { backfillDocumentArchive } from '../../src/modules/documents/application/backfill-document-archive'

function archiveFake(){
  const docs:any[]=[];const versions:any[]=[];const links:any[]=[]
  const stored={id:'blob',sha256:'a'.repeat(64),mediaType:'application/pdf',bucket:'test',objectKey:'original',byteSize:100n}
  const collected=[{id:'collected',title:'Gazette document',sourceUrl:'https://official.org/a.pdf',externalSourceDocumentId:null,storedObject:stored,edition:{scanRunId:'scan',publicationDate:new Date('2026-10-10'),scanRun:{}}}]
  const sourceRows=[{id:'source-doc',title:'Date unknown',url:'https://other.org/b',publishedOn:null,contentText:'Actual legacy source text',capturedFiles:null,runId:'source-run',run:{sourceId:'external-source',scanRunId:null}}]
  const prisma:any={
    collectedDocument:{findMany:vi.fn(async({cursor}:any)=>cursor?[]:collected)},sourceScanDocument:{findMany:vi.fn(async({cursor}:any)=>cursor?[]:sourceRows),findUnique:vi.fn()},source:{findUnique:vi.fn(async()=>({id:'gazette-source'}))},storedObject:{findUnique:vi.fn()},
    document:{findUnique:vi.fn(async({where}:any)=>docs.find(d=>d.canonicalUrl===where.canonicalUrl)??null),upsert:vi.fn(async({create}:any)=>{let d=docs.find(d=>d.canonicalUrl===create.canonicalUrl);if(!d){d={...create,id:`d${docs.length}`};docs.push(d)}return d})},
    documentVersion:{upsert:vi.fn(async({create}:any)=>{let v=versions.find(v=>v.documentId===create.documentId&&v.contentHash===create.contentHash);if(!v){v={...create,id:`v${versions.length}`};versions.push(v)}return v}),update:vi.fn()},
    documentLink:{findFirst:vi.fn(async({where}:any)=>links.find(l=>l.documentVersionId===where.documentVersionId&&l.sourceRunId===where.sourceRunId&&l.scanRunId===where.scanRunId)??null),create:vi.fn(async({data}:any)=>{links.push(data);return data})},$executeRaw:vi.fn(),$transaction:async(fn:any)=>fn(prisma)
  }
  return {prisma:prisma as PrismaClient,docs,versions,links}
}
describe('additive historical archive backfill',()=>{
  it('defaults to dry run with no persistence or inferred provenance',async()=>{
    const fake=archiveFake();const result=await backfillDocumentArchive(fake.prisma)
    expect(result).toMatchObject({mode:'DRY_RUN',collectedDocuments:1,sourceDocuments:1,mappedVersions:2,missingBytes:1});expect(fake.docs).toHaveLength(0);expect(fake.versions).toHaveLength(0)
  })
  it('preserves exact source dates and text, does not invent capture dates or bytes, and reruns idempotently',async()=>{
    const fake=archiveFake();await backfillDocumentArchive(fake.prisma,{apply:true});await backfillDocumentArchive(fake.prisma,{apply:true})
    expect(fake.docs).toHaveLength(2);expect(fake.versions).toHaveLength(2);expect(fake.links).toHaveLength(2)
    expect(fake.docs[0].publishedOn.toISOString().slice(0,10)).toBe('2026-10-10');expect(fake.docs[1].publishedOn).toBeNull()
    expect(fake.versions[1]).toMatchObject({storedObjectId:null,extractedText:'Actual legacy source text',fetchedAt:null,extractionMetadata:{contentBasis:'RECORDED_TEXT'}})
    expect(fake.versions[0]).toMatchObject({storedObjectId:'blob',fetchedAt:null,extractionMetadata:{contentBasis:'ARCHIVED_BYTES'}})
  })
  it('never claims another access scope canonical document',async()=>{
    const fake=archiveFake();fake.docs.push({id:'private',canonicalUrl:'https://official.org/a.pdf',actorScope:'private-workspace',sourceId:'gazette-source'})
    const result=await backfillDocumentArchive(fake.prisma,{apply:true})
    expect(result.scopeConflicts).toBe(1);expect(fake.versions).toHaveLength(1);expect(fake.docs[0].actorScope).toBe('private-workspace')
  })
})
