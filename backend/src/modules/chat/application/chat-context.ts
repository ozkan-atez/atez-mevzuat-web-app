import type { AssistantKnowledge } from './assistant-knowledge'
import type { ChatMessageView } from './ports'
export interface ChatContext { mode:'SELECTED'|'WEB'|'BROWSER';sourceIds:string[];documentVersionIds:string[];templateId?:string|undefined;templateRevision?:number|undefined;sourceProfiles?:Array<{sourceId:string;version:number|null}> }
export const emptyChatContext = ():ChatContext=>({mode:'SELECTED',sourceIds:[],documentVersionIds:[]})
export class ChatScopeError extends Error { override name='ChatScopeError' }
export interface ChatScope {
 hasFileSources?:boolean;evidenceVersionIds?:string[];context:ChatContext;knowledge:AssistantKnowledge;sourceKeys:string[];
 assertOperation(input:Record<string,unknown>):Promise<void>
}
export interface ChatScopeResolver {resolve(context:ChatContext):Promise<ChatScope>}
/** Old exchanges with broader evidence are visible in the UI but excluded from new prompts. */
export function historyWithinContext(messages:ChatMessageView[],context:ChatContext) {
 return messages.filter(message=>message.context?.mode===context.mode && message.context.sourceIds.every(id=>context.sourceIds.includes(id)) && message.context.documentVersionIds.every(id=>context.documentVersionIds.includes(id)) && message.context.templateId===context.templateId)
}
