export type ChatRole = 'USER' | 'ASSISTANT'
export type ChatMessageStatus = 'COMPLETED' | 'FAILED'

export interface ChatSessionView {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
}

export interface ChatMessageView {
  id: string
  role: ChatRole
  content: string
  status: ChatMessageStatus
  errorDetail: string | null
  createdAt: string
  attachment?: ChatAttachmentView
}

export interface ChatAttachmentView {
  id: string
  name: string
  mediaType: string
  byteSize: number
}

export interface ChatAttachmentInput {
  name: string
  mediaType: string
  bytes: Buffer
}

/**
 * One row of the unified history.
 *
 * General conversations and report revision threads live in different aggregates.
 * Report threads also carry their run so the history can group them by scan.
 */
export interface ChatHistoryItem {
  id: string
  type: 'GENERAL' | 'REPORT_REVISION'
  title: string
  titlePending?: boolean
  preview: string | null
  messageCount: number
  updatedAt: string
  target: string
  run?: { id: string; targetDate: string; status?: string }
}

export interface AppendChatMessageInput {
  sessionId: string
  role: ChatRole
  content: string
  status: ChatMessageStatus
  errorDetail?: string | null
  attachment?: ChatAttachmentInput
}

export interface ChatRepository {
  createSession(): Promise<ChatSessionView>
  sessionExists(id: string): Promise<boolean>
  getMessages(sessionId: string): Promise<ChatMessageView[]>
  getSessionTitle(sessionId: string): Promise<string | null>
  setTitleIfMatches(sessionId: string, expectedTitle: string | null, title: string): Promise<void>
  appendMessage(input: AppendChatMessageInput): Promise<ChatMessageView>
  listHistory(): Promise<ChatHistoryItem[]>
  deleteSession(id: string): Promise<boolean>
  getAttachment?(sessionId: string, attachmentId: string): Promise<(ChatAttachmentInput & { id: string }) | null>
}

export class ChatSessionNotFoundError extends Error {
  override name = 'ChatSessionNotFoundError'
}
