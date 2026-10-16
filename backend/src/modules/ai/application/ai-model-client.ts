export type AiInputPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }

export interface StructuredAiRequest {
  onUsage?: (usage: import('../../usage/measurement').TokenUsage) => Promise<void>
  model: string
  systemInstruction: string
  parts: AiInputPart[]
  responseJsonSchema: Record<string, unknown>
}

export interface StructuredAiResult {
  json: unknown
  providerRequestId: string | null
  usage: {
    totalTokens?: number | null
    cachedTokens?: number | null
    reasoningTokens?: number | null
    inputTokens: number | null
    outputTokens: number | null
  }
}

export interface AiModelClient {
  generateStructured(request: StructuredAiRequest): Promise<StructuredAiResult>
}
