import {it,expect,vi} from 'vitest'
import type {PrismaClient} from '@prisma/client'
import {PrismaScanRepository} from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'
it('excludes only earlier completed publications of the same automation and keeps new supplements',async()=>{
 const findMany=vi.fn(async()=>[{sourceUrl:'https://rg/old.htm'}]),createMany=vi.fn()
 const tx={scanRun:{update:vi.fn(),findUniqueOrThrow:vi.fn(async()=>({automationId:'a',workspaceId:'w',createdAt:new Date('2026-10-14')}))},collectedDocument:{findMany,createMany},gazetteEdition:{upsert:vi.fn(async()=>({id:'edition'}))}}
 const repo=new PrismaScanRepository({$transaction:async(fn:any)=>fn(tx)} as unknown as PrismaClient)
 await repo.saveEditions('current','2026-10-14',[{type:'MAIN',supplementNo:null,indexUrl:'https://rg/index',discoveryOrder:0,documents:[{title:'Old',sourceUrl:'https://rg/old.htm',publicationOrder:0},{title:'New',sourceUrl:'https://rg/new.htm',publicationOrder:1}]}])
 expect(findMany).toHaveBeenCalledWith(expect.objectContaining({where:{edition:{publicationDate:new Date('2026-10-14T00:00:00Z'),scanRun:{automationId:'a',workspaceId:'w',status:'COMPLETED',id:{not:'current'},createdAt:{lt:new Date('2026-10-14')}}}}}))
 expect(createMany).toHaveBeenCalledWith({data:[{editionId:'edition',title:'New',documentType:null,sourceUrl:'https://rg/new.htm',publicationOrder:1}],skipDuplicates:true})
})

it('keeps every document for a new manual scan, even if the URL was processed before',async()=>{
 const findMany=vi.fn(),createMany=vi.fn(),update=vi.fn()
 const tx={scanRun:{update,findUniqueOrThrow:vi.fn(async()=>({automationId:null,workspaceId:'w',createdAt:new Date()}))},collectedDocument:{findMany,createMany},gazetteEdition:{upsert:vi.fn(async()=>({id:'edition'}))}}
 const repo=new PrismaScanRepository({$transaction:async(fn:any)=>fn(tx)} as unknown as PrismaClient)
 const result=await repo.saveEditions('manual','2026-10-14',[{type:'MAIN',supplementNo:null,indexUrl:'https://rg/index',discoveryOrder:0,documents:[{title:'Old',sourceUrl:'https://rg/old.htm',publicationOrder:0}]}])
 expect(result).toEqual({discovered:1,skipped:0})
 expect(findMany).not.toHaveBeenCalled()
 expect(createMany.mock.calls[0]![0].data).toHaveLength(1)
})

it.each([
 {automationId:'a',discoveredDocumentCount:13,skippedDocumentCount:13,allowed:true},
 {automationId:null,discoveredDocumentCount:13,skippedDocumentCount:13,allowed:false},
 {automationId:'a',discoveredDocumentCount:0,skippedDocumentCount:0,allowed:false},
 {automationId:'a',discoveredDocumentCount:13,skippedDocumentCount:12,allowed:false},
])('validates empty runs only when all discoveries were intentionally skipped: %j',async({allowed,...run})=>{
 const repo=new PrismaScanRepository({collectedDocument:{count:vi.fn(async()=>0)},documentAsset:{count:vi.fn(async()=>0)},scanRun:{findUniqueOrThrow:vi.fn(async()=>run)}} as unknown as PrismaClient)
 if(allowed)await expect(repo.verifyManifestCounts('run')).resolves.toBeUndefined()
 else await expect(repo.verifyManifestCounts('run')).rejects.toThrow('Manifest verification failed')
})
