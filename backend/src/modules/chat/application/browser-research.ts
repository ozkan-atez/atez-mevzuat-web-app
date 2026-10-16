import type { WebResearch } from './web-grounding'
export type BrowserResearchEvent = {type:'activity';label:string} | {type:'result';content:string;research:WebResearch}
export interface BrowserResearch {run(input:{content:string;signal?:AbortSignal;usage?: {recorder: import('../../usage/measurement').UsageRecorder; context: Pick<import('../../usage/measurement').UsageCall, 'conversationId' | 'conversationType' | 'messageId'>; onCall: () => void}}):AsyncIterable<BrowserResearchEvent>}

export class BrowserResearchError extends Error {
  constructor(readonly category:string,readonly publicMessage:string,readonly diagnostics?:{blockReason?:string;candidateCount?:number}) {
    super(publicMessage)
    this.name='BrowserResearchError'
  }
}
