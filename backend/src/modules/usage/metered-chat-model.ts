import { randomUUID } from 'node:crypto'
import type { ChatModelClient, ChatModelChunk } from '../chat/application/chat-model-client'
import type { UsageInput } from './usage'
export type UsageRecorder=(input:UsageInput)=>Promise<unknown>
export function meteredChatModel(model:ChatModelClient,record:UsageRecorder,context:{sessionId:string;messageId:string}):ChatModelClient {
 return {async *streamReply(input) {
  const callId=randomUUID();let usage:Partial<UsageInput>={};let status:UsageInput['status']='RUNNING'
  await record({...context,callId,category:'GENERAL_CHAT',model:input.model,status})
  try {
   for await(const chunk of model.streamReply(input)) {
    if(chunk.type==='usage') {usage=chunk.usage;await record({...context,callId,category:'GENERAL_CHAT',model:input.model,status,...usage})}
    else yield chunk as ChatModelChunk
   }
   status='COMPLETED'
  } catch(error) {status=input.signal?.aborted?'CANCELLED':'FAILED';throw error}
  finally {if(status==='RUNNING')status=input.signal?.aborted?'CANCELLED':'FAILED';await record({...context,callId,category:'GENERAL_CHAT',model:input.model,...usage,status})}
 }}
}
