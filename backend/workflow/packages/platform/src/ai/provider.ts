export type AiPart = { text: string } | { inline: { mime: string; data: Uint8Array } }

export interface ProviderRequest {
  model: string
  system?: string
  parts: AiPart[]
  jsonSchema?: unknown
  temperature?: number
  mediaResolution?: 'low' | 'medium' | 'high'
  thinking?: 'minimal' | 'low' | 'medium' | 'high'
}

export interface ProviderUsage {
  inputTokens: number | null
  outputTokens: number | null
  cachedTokens: number | null
  thinkingTokens: number | null
}

export interface ProviderResponse {
  text: string
  usage: ProviderUsage | null
  finishReason: string | null
}

export class ProviderError extends Error {
  override name = 'ProviderError'
  constructor(message: string, readonly transient: boolean, readonly status: number | null = null, options?: { cause?: unknown }) {
    super(message, options)
  }
}

export interface AiProvider {
  readonly name: string
  readonly location: string | null
  generate(req: ProviderRequest): Promise<ProviderResponse>
}
