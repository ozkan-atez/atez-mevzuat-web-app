import type { ChatContext } from './create-chat-report'
import type { WebResearch } from './web-grounding'
export type ChatRole = 'USER' | 'ASSISTANT'
export type ChatMessageStatus = 'COMPLETED' | 'FAILED'

export interface ChatSessionView {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
}

export interface ChatMessageView {
  context?: ChatContext
  authorId?: string | null
  authorName?: string | null
  baseVersion?: number | null
  reportVersion?: number
  changePaths?: string[]
  research?: WebResearch
  id: string
  role: ChatRole
  content: string
  status: ChatMessageStatus
  errorDetail: string | null
  createdAt: string
  documentVersionIds?: string[]
  operationRequestIds?: string[]
}

/**
 * One row of the unified history.
 *
 * General conversations and report revision threads live in different aggregates
 * but the user thinks of them as one list of things they have talked to the
 * assistant about, so the projection carries the discriminant and the place to
 * navigate to instead of making the client guess.
 */
export interface ChatHistoryItem {
  id: string
  type: 'GENERAL' | 'REPORT_REVISION'
  title: string
  preview: string | null
  messageCount: number
  updatedAt: string
  target: string
}

export interface AppendChatMessageInput {
  context?: ChatContext
  research?: WebResearch
  sessionId: string
  role: ChatRole
  content: string
  status: ChatMessageStatus
  errorDetail?: string | null
  documentVersionIds?: string[]
  operationRequestIds?: string[]
}

export interface ChatRepository {
  getReportThread?(key: string): Promise<{reportId: string; topicId: string | null; title: string; latestVersion: number; messages: ChatMessageView[]; revisions: Array<{version: number; createdAt: string}>} | null>
  getTitleSeed?(sessionId:string,messageId:string):Promise<string|null>
  setGeneratedTitle?(sessionId:string,title:string):Promise<void>
  createSession(): Promise<ChatSessionView>
  sessionExists(id: string): Promise<boolean>
  getMessages(sessionId: string): Promise<ChatMessageView[]>
  appendMessage(input: AppendChatMessageInput): Promise<ChatMessageView>
  listHistory(): Promise<ChatHistoryItem[]>
  deleteSession(id: string): Promise<boolean>
}

export class ChatSessionNotFoundError extends Error {
  override name = 'ChatSessionNotFoundError'
}
