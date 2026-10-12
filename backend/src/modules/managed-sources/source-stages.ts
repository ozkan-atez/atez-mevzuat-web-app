import type { PrismaClient } from '@prisma/client'
export const SOURCE_STAGES = ['ACCESS','DISCOVERY','CAPTURE','VALIDATION','FILTER','PREVIOUS_SOURCES','ANALYSIS','REPORT','COMPLETE'] as const
export type SourceStage = typeof SOURCE_STAGES[number]
export async function initializeSourceStages(prisma:PrismaClient,runId:string) {
  for(const stage of SOURCE_STAGES) await prisma.sourceRunStage.upsert({where:{runId_stage:{runId,stage}},create:{runId,stage},update:{status:'PENDING',error:null,startedAt:null,completedAt:null,totalItems:0,completedItems:0}})
}
export async function recordSourceStage(prisma:PrismaClient,runId:string,stage:SourceStage,status:string,totalItems=0,completedItems=0,error:string|null=null) {
  await prisma.sourceRunStage.upsert({where:{runId_stage:{runId,stage}},create:{runId,stage,status,totalItems,completedItems,error},update:{status,totalItems,completedItems,error,...(status==='RUNNING'?{startedAt:new Date(),completedAt:null}:{completedAt:new Date()})}})
}
export async function stopPendingStages(prisma:PrismaClient,runId:string) {await prisma.sourceRunStage.updateMany({where:{runId,status:'PENDING'},data:{status:'SKIPPED',completedAt:new Date()}})}
