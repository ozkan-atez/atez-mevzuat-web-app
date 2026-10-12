import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'

describe('scan run automation names',()=>{
  it('uses the run snapshot, falls back to the saved automation for older runs and labels legacy schedule slots',async()=>{
    const base={trigger:'CRON',status:'COMPLETED',currentStage:null,targetDate:new Date('2026-10-12'),createdAt:new Date('2026-10-12'),startedAt:null,completedAt:null,editions:[]}
    const findMany=vi.fn(async()=>[{id:'automation',name:'Güncel otomasyon adı'}])
    const prisma={scanRun:{findMany:vi.fn(async()=>[
      {...base,id:'snapshot',automationId:'automation',workspaceConfig:{automationName:'Çalışma anındaki ad'},scheduleSlot:null},
      {...base,id:'legacy',automationId:'automation',workspaceConfig:null,scheduleSlot:null},
      {...base,id:'slot',automationId:null,workspaceConfig:null,scheduleSlot:'ANA_SAYI'},
      {...base,id:'manual',automationId:null,workspaceConfig:null,scheduleSlot:null,trigger:'MANUAL'},
    ])},workspaceAutomation:{findMany}} as unknown as PrismaClient
    const result=await new PrismaScanRepository(prisma).listRuns(10)
    expect(result.map(run=>[run.automationName,run.scheduleLabel])).toEqual([
      ['Çalışma anındaki ad',null],['Güncel otomasyon adı',null],[null,'Ana Sayı'],[null,null],
    ])
    expect(findMany).toHaveBeenCalledOnce()
    expect(findMany).toHaveBeenCalledWith({where:{id:{in:['automation']}},select:{id:true,name:true}})
  })
})
