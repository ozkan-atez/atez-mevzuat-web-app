import type { PrismaClient } from '@prisma/client'
import { getActorContext } from '../../platform/actor-context'
export type UsageCategory = 'GENERAL_CHAT' | 'REPORT_REVISION' | 'SCAN_ANALYSIS' | 'SOURCE_SETUP' | 'TEMPLATE_GENERATION'
export interface UsageInput {
 callId:string;category:UsageCategory;model:string;provider?:string;status:'RUNNING'|'COMPLETED'|'FAILED'|'CANCELLED'|'NO_AI';
 inputTokens?:number|null;outputTokens?:number|null;totalTokens?:number|null;cachedTokens?:number|null;reasoningTokens?:number|null;
 sessionId?:string;messageId?:string;reportId?:string;operationId?:string
}
/** One row per provider invocation; cumulative stream measurements replace, never add. */
export async function recordUsage(prisma:PrismaClient,input:UsageInput) {
 const actor=getActorContext()
 const data={...input,provider:input.provider??'gemini',workspaceId:actor?.workspaceId??null,actorUserId:actor?.userId??null}
 return prisma.aiUsageEvent.upsert({where:{callId:input.callId},create:data,update:input})
}
