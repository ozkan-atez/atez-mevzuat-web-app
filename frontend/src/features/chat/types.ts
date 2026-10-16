export interface WebResearch {
  mode?:'browser'
  completed?:boolean
  sources:Array<{title:string;url:string}>
  citations:Array<{endIndex:number;text?:string;sourceIndices:number[]}>
  queries:string[]
  searchSuggestions:string|null
}
export interface ChatSendOptions {sourceIds?: string[]; templateId?: string;webSearch?:boolean;browserAgent?:boolean}
export type ChatRole = 'USER' | 'ASSISTANT'
export type ChatMessageStatus = 'COMPLETED' | 'FAILED'

export interface ChatMessage {
  authorId?: string | null
  authorName?: string | null
  baseVersion?: number | null
  reportVersion?: number
  changePaths?: string[]
  research?:WebResearch
  id: string
  role: ChatRole
  content: string
  status: ChatMessageStatus
  errorDetail: string | null
  createdAt: string
  documentVersionIds?: string[]
  operationRequestIds?: string[]
}

export interface ChatSession {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
}

export interface ChatHistoryItem {
  id: string
  type: 'GENERAL' | 'REPORT_REVISION'
  title: string
  preview: string | null
  messageCount: number
  updatedAt: string
  /** Where selecting this item goes: a chat route, or the report it belongs to. */
  target: string
}

export type ChatStreamEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'delta'; content: string }
  /** The assistant is reading the platform's own data; shown while it happens. */
  | { type: 'tool'; name: string; label: string }
  | { type: 'complete'; message: ChatMessage }
  | { type: 'error'; message: string }

export const MAX_MESSAGE_LENGTH = 8_000
