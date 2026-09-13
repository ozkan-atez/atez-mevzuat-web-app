export type AiInputPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }

export interface StructuredAiRequest {
  model: string
  systemInstruction: string
  parts: AiInputPart[]
  responseJsonSchema: Record<string, unknown>
}

export interface StructuredAiResult {
  json: unknown
  providerRequestId: string | null
  usage: {
    inputTokens: number | null
    outputTokens: number | null
  }
}

export interface AiModelClient {
  generateStructured(request: StructuredAiRequest): Promise<StructuredAiResult>
}
