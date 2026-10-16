import {it,expect,vi} from 'vitest'
import type {PrismaClient} from '@prisma/client'
import {PrismaScanRepository} from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'
it('excludes only earlier completed publications of the same automation and keeps new supplements',async()=>{
 const findMany=vi.fn(async()=>[{sourceUrl:'https://rg/old.htm'}]),createMany=vi.fn()
 const tx={scanRun:{findUniqueOrThrow:vi.fn(async()=>({automationId:'a',workspaceId:'w',createdAt:new Date('2026-10-14')}))},collectedDocument:{findMany,createMany},gazetteEdition:{upsert:vi.fn(async()=>({id:'edition'}))}}
 const repo=new PrismaScanRepository({$transaction:async(fn:any)=>fn(tx)} as unknown as PrismaClient)
 await repo.saveEditions('current','2026-10-14',[{type:'MAIN',supplementNo:null,indexUrl:'https://rg/index',discoveryOrder:0,documents:[{title:'Old',sourceUrl:'https://rg/old.htm',publicationOrder:0},{title:'New',sourceUrl:'https://rg/new.htm',publicationOrder:1}]}])
 expect(findMany).toHaveBeenCalledWith(expect.objectContaining({where:{edition:{publicationDate:new Date('2026-10-14T00:00:00Z'),scanRun:{automationId:'a',workspaceId:'w',status:'COMPLETED',id:{not:'current'},createdAt:{lt:new Date('2026-10-14')}}}}}))
 expect(createMany).toHaveBeenCalledWith({data:[{editionId:'edition',title:'New',documentType:null,sourceUrl:'https://rg/new.htm',publicationOrder:1}],skipDuplicates:true})
})
