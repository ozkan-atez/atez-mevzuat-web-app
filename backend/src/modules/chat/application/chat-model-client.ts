import type { ChatMessageView } from './ports'

export interface ChatModelRequest {
  model: string
  systemInstruction: string
  messages: Array<{ role: 'user' | 'model'; content: string }>
  signal?: AbortSignal
}

/**
 * Text generation for conversation, kept separate from the structured-output
 * client the analysis and revision paths depend on: a loose free-text contract
 * must not be able to weaken the schema those paths are validated against.
 */
export interface ChatModelClient {
  streamReply(input: ChatModelRequest): AsyncIterable<string>
}

export type ChatStreamEvent =
  | { type: 'message'; message: ChatMessageView }
  | { type: 'delta'; content: string }
  | { type: 'complete'; message: ChatMessageView }
  | { type: 'error'; message: string }
