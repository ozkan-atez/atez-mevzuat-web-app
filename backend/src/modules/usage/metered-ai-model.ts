import {randomUUID} from 'node:crypto'
import type {AiModelClient,StructuredAiResult} from '../ai/application/ai-model-client'
import type {UsageRecorder} from './metered-chat-model'
import type {UsageCategory} from './usage'
export function meteredAiModel(model:AiModelClient,record:UsageRecorder,category:UsageCategory,links:()=>{reportId?:string;sessionId?:string;operationId?:string}=()=>({})):AiModelClient {
 return {async generateStructured(request){
  const callId=randomUUID(),context=links()
  await record({...context,callId,category,model:request.model,status:'RUNNING'})
  try {
   const result=await model.generateStructured(request)
   await record({...context,callId,category,model:request.model,status:'COMPLETED',...result.usage,totalTokens:result.usage.totalTokens??null})
   return result
  }catch(error){
   const usage=error&&typeof error==='object'&&'usage' in error?error.usage as StructuredAiResult['usage']:{}
   await record({...context,callId,category,model:request.model,status:'FAILED',...usage})
   throw error
  }
 }}
}
