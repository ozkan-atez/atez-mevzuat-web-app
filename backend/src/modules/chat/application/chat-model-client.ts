import type { ChatToolDeclaration } from './chat-tools'
import type { ChatMessageView } from './ports'

export interface ToolCall {
  name: string
  args: Record<string, unknown>
  /**
   * Opaque provider token that must travel back with the call.
   *
   * Gemini 3 rejects a conversation that replays a function call without the
   * signature it issued, so the use case carries it through untouched rather
   * than reconstructing the call from its name and arguments.
   */
  signature?: string
}

/**
 * One entry of what the model is shown.
 *
 * Tool calls and their results are turns of their own: the model must see the
 * question it asked next to the answer it got, or a second round would repeat
 * the same lookup.
 */
export type ChatTurn =
  | { role: 'user'; content: string }
  | { role: 'model'; content: string }
  | { role: 'tool-calls'; calls: ToolCall[] }
  | { role: 'tool-results'; results: Array<{ name: string; response: unknown }> }

export type ChatModelChunk =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; call: ToolCall }

export interface ChatModelRequest {
  model: string
  systemInstruction: string
  turns: ChatTurn[]
  tools?: ChatToolDeclaration[]
  signal?: AbortSignal
}

/**
 * Text generation for conversation, kept separate from the structured-output
 * client the analysis and revision paths depend on: a loose free-text contract
 * must not be able to weaken the schema those paths are validated against.
 */
export interface ChatModelClient {
  streamReply(input: ChatModelRequest): AsyncIterable<ChatModelChunk>
}

export type ChatStreamEvent =
  | { type: 'message'; message: ChatMessageView }
  | { type: 'delta'; content: string }
  /** The assistant is consulting the platform's own data; shown while it happens. */
  | { type: 'tool'; name: string; label: string }
  | { type: 'complete'; message: ChatMessageView }
  | { type: 'error'; message: string }
