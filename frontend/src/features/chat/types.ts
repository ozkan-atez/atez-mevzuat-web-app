export type ChatRole = 'USER' | 'ASSISTANT'
export type ChatMessageStatus = 'COMPLETED' | 'FAILED'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  status: ChatMessageStatus
  errorDetail: string | null
  createdAt: string
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
  | { type: 'complete'; message: ChatMessage }
  | { type: 'error'; message: string }

export const MAX_MESSAGE_LENGTH = 8_000
