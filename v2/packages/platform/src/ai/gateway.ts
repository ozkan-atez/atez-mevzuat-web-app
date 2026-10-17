import { z } from 'zod'
import { TransientError, PermanentError } from '../errors'
import type { Db } from '../db/client'
import { aiCall } from '../db/schema/ai'
import { sha256 } from '../hash'
import type { AiConfig, ModelTier } from './config'
import { ProviderError, type AiPart, type AiProvider, type ProviderUsage } from './provider'

export interface AiCallContext {
  runId?: string | null
  workItemId?: string | null
  stepKey?: string | null
}

export interface GenerateRequest<T> {
  tier: ModelTier
  purpose: string
  promptVersion: string
  system?: string
  /** Belge parçaları önce, talimat en sonda olmalı. */
  parts: AiPart[]
  schema?: z.ZodType<T>
  /**
   * Gemini'ye giden şemadan sayısal/uzunluk sınırlarını çıkarır (doğrulama yine zod ile).
   * Karmaşık şemalarda Vertex 400 INVALID_ARGUMENT dönebiliyor (canlı deneme 2026-10-17).
   */
  relaxSchema?: boolean
  temperature?: number
  mediaResolution?: 'low' | 'medium' | 'high'
  thinking?: 'minimal' | 'low' | 'medium' | 'high'
  context?: AiCallContext
  /** Ham yanıtın saklandığı MinIO anahtarı (çağıran yazar); ai_call'a referans olarak düşülür. */
  responseKey?: string
}

export interface GenerateResult<T> {
  aiCallId: string
  model: string
  text: string
  data: T
  usage: ProviderUsage | null
}

/**
 * Tek AI geçidi (§2 ilke 9): model seçimi, kayıt (`ai_call`), hata sınıflandırması ve maliyet
 * tek noktadan. Her çağrı — başarılı ya da değil — ayrı bir bağlantıyla kaydedilir; adımın
 * transaction'ı geri alınsa bile maliyet kaybolmaz.
 */
export class AiGateway {
  constructor(
    private readonly db: Db,
    private readonly provider: AiProvider,
    readonly config: AiConfig,
  ) {}

  modelFor(tier: ModelTier): string {
    return this.config.models[tier]
  }

  async generate<T = string>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const model = this.modelFor(req.tier)
    const jsonSchema = req.schema ? toGeminiJsonSchema(req.schema, { relax: req.relaxSchema }) : undefined
    const requestHash = sha256(
      [model, req.promptVersion, req.system ?? '', ...req.parts.map((p) => ('text' in p ? sha256(p.text) : sha256(p.inline.data)))].join('|'),
    )
    const started = Date.now()
    const base = {
      runId: req.context?.runId ?? null,
      workItemId: req.context?.workItemId ?? null,
      stepKey: req.context?.stepKey ?? null,
      purpose: req.purpose,
      tier: req.tier,
      provider: this.provider.name,
      model,
      location: this.provider.location,
      promptVersion: req.promptVersion,
      requestHash,
    }
    let text: string
    let usage: ProviderUsage | null
    try {
      const res = await this.provider.generate({
        model,
        system: req.system,
        parts: req.parts,
        jsonSchema,
        temperature: req.temperature,
        mediaResolution: req.mediaResolution,
        thinking: req.thinking,
      })
      text = res.text
      usage = res.usage
    } catch (err) {
      const transient = err instanceof ProviderError ? err.transient : true
      await this.record({ ...base, status: 'ERROR', errorKind: transient ? 'TRANSIENT' : 'PERMANENT', errorMessage: errMsg(err), latencyMs: Date.now() - started })
      if (transient) throw new TransientError(`AI çağrısı başarısız: ${errMsg(err)}`, 'AI_TRANSIENT', { cause: err })
      throw new PermanentError(`AI çağrısı reddedildi: ${errMsg(err)}`, 'AI_REJECTED', { cause: err })
    }

    let data: T
    try {
      data = req.schema ? req.schema.parse(JSON.parse(text)) : (text as T)
    } catch (err) {
      const id = await this.record({ ...base, ...usageCols(usage), status: 'INVALID_OUTPUT', errorKind: 'TRANSIENT', errorMessage: errMsg(err).slice(0, 2000), latencyMs: Date.now() - started, costUsd: this.cost(model, usage), responseKey: req.responseKey ?? null })
      throw new TransientError(`AI çıktısı şemaya uymuyor (ai_call ${id})`, 'AI_INVALID_OUTPUT', { cause: err })
    }
    const id = await this.record({ ...base, ...usageCols(usage), status: 'OK', latencyMs: Date.now() - started, costUsd: this.cost(model, usage), responseKey: req.responseKey ?? null })
    return { aiCallId: id, model, text, data, usage }
  }

  private cost(model: string, usage: ProviderUsage | null): string | null {
    const p = this.config.pricing[model]
    if (!p || !usage || usage.inputTokens === null || usage.outputTokens === null) return null
    const cached = usage.cachedTokens ?? 0
    const fresh = usage.inputTokens - cached
    const usd =
      (fresh * p.inputPerM + cached * (p.cachedInputPerM ?? p.inputPerM) + (usage.outputTokens + (usage.thinkingTokens ?? 0)) * p.outputPerM) / 1_000_000
    return usd.toFixed(6)
  }

  private async record(row: typeof aiCall.$inferInsert): Promise<string> {
    const [r] = await this.db.insert(aiCall).values(row).returning({ id: aiCall.id })
    return r!.id
  }
}

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err))
const usageCols = (u: ProviderUsage | null) => ({
  inputTokens: u?.inputTokens ?? null,
  outputTokens: u?.outputTokens ?? null,
  cachedTokens: u?.cachedTokens ?? null,
  thinkingTokens: u?.thinkingTokens ?? null,
})

/** zod → JSON Schema; Gemini'nin desteklemediği anahtarlar ayıklanır (doğrulama zod ile yapılır). */
const BOUNDS = new Set(['maxLength', 'minLength', 'maxItems', 'minItems', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'])

export function toGeminiJsonSchema(schema: z.ZodType, opts: { relax?: boolean } = {}): unknown {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any' }) as Record<string, unknown>
  // `properties` altındaki anahtarlar alan adıdır (ör. "format" adlı bir alan); yalnızca şema
  // anahtar kelimeleri ayıklanır.
  const strip = (node: unknown, isPropertyMap = false): unknown => {
    if (Array.isArray(node)) return node.map((n) => strip(n))
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(node)) {
        if (!isPropertyMap && (k === '$schema' || k === 'pattern' || k === 'additionalProperties' || (k === 'format' && typeof v === 'string'))) continue
        if (!isPropertyMap && opts.relax && BOUNDS.has(k) && typeof v === 'number') continue
        out[k] = strip(v, !isPropertyMap && k === 'properties')
      }
      return out
    }
    return node
  }
  return strip(json)
}
