import { readFileSync } from 'node:fs'
import { ApiError, GoogleGenAI, MediaResolution, ThinkingLevel, type Part } from '@google/genai'
import { ProviderError, type AiProvider, type ProviderRequest, type ProviderResponse } from './provider'

const MEDIA: Record<NonNullable<ProviderRequest['mediaResolution']>, MediaResolution> = {
  low: MediaResolution.MEDIA_RESOLUTION_LOW,
  medium: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
  high: MediaResolution.MEDIA_RESOLUTION_HIGH,
}
const THINKING: Record<NonNullable<ProviderRequest['thinking']>, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
}

/**
 * Vertex AI (`global` uç noktası; VERTEX_LOCATION ile değişir). Kimlik: servis hesabı anahtar dosyası (`keyFilename`); verilmezse
 * Application Default Credentials.
 */
export class VertexProvider implements AiProvider {
  readonly name = 'vertex'
  private readonly client: GoogleGenAI
  constructor(readonly project: string, readonly location: string, keyFilename?: string) {
    this.client = new GoogleGenAI({ vertexai: true, project, location, ...(keyFilename ? { googleAuthOptions: { keyFilename } } : {}) })
  }

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    // Belge önce, talimat sonda (§6.3: ardışık adımlar örtük önbellekten yararlanır).
    const parts: Part[] = req.parts.map((p) =>
      'text' in p ? { text: p.text } : { inlineData: { mimeType: p.inline.mime, data: Buffer.from(p.inline.data).toString('base64') } },
    )
    try {
      const res = await this.client.models.generateContent({
        model: req.model,
        contents: [{ role: 'user', parts }],
        config: {
          ...(req.system ? { systemInstruction: req.system } : {}),
          ...(req.jsonSchema ? { responseMimeType: 'application/json', responseJsonSchema: req.jsonSchema } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.mediaResolution ? { mediaResolution: MEDIA[req.mediaResolution] } : {}),
          ...(req.thinking ? { thinkingConfig: { thinkingLevel: THINKING[req.thinking] } } : {}),
        },
      })
      const u = res.usageMetadata
      return {
        text: res.text ?? '',
        finishReason: res.candidates?.[0]?.finishReason ?? null,
        usage: u
          ? {
              inputTokens: u.promptTokenCount ?? null,
              outputTokens: u.candidatesTokenCount ?? null,
              cachedTokens: u.cachedContentTokenCount ?? null,
              thinkingTokens: u.thoughtsTokenCount ?? null,
            }
          : null,
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const transient = err.status === 429 || err.status >= 500
        throw new ProviderError(err.message, transient, err.status, { cause: err })
      }
      // Ağ / kimlik yenileme hataları geçici sayılır.
      throw new ProviderError(err instanceof Error ? err.message : String(err), true, null, { cause: err })
    }
  }
}

/** Proje kimliğini anahtar dosyasından okur (yalnızca `project_id`; başka alan okunmaz/loglanmaz). */
export function projectIdFromKeyFile(keyFilename: string): string | undefined {
  try {
    const id = (JSON.parse(readFileSync(keyFilename, 'utf8')) as { project_id?: unknown }).project_id
    return typeof id === 'string' && id ? id : undefined
  } catch {
    return undefined
  }
}
