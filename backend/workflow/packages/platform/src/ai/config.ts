import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export const ModelTier = z.enum(['main', 'lite'])
export type ModelTier = z.infer<typeof ModelTier>

/**
 * Tek AI yapılandırması (§0.1, Ek B.3 madde 10). Model kimlikleri sürüm sabitlenmiş olarak
 * yalnızca burada (ve config/ai.json'da) yaşar.
 */
export const AiConfig = z.object({
  provider: z.literal('vertex'),
  models: z.object({ main: z.string().min(1), lite: z.string().min(1) }),
  /** Profil adımı varsayılanı (§6.3): medium ≈ 560 token/sayfa. */
  mediaResolution: z.enum(['low', 'medium', 'high']).default('medium'),
  /** Tek istekte satır içi (inlineData) gönderilebilecek toplam bayt (dalın 18 MB bütçesi). */
  inlineBudgetBytes: z.number().int().positive().default(18 * 1024 * 1024),
  /** PDF parça sınırları (§6.3). */
  maxPagesPerPart: z.number().int().positive().default(1000),
  /** USD / 1M token. Verilmezse maliyet `null` (hesaplanmadı) yazılır. */
  pricing: z
    .record(z.string(), z.object({ inputPerM: z.number(), outputPerM: z.number(), cachedInputPerM: z.number().optional() }))
    .default({}),
})
export type AiConfig = z.infer<typeof AiConfig>

export const DEFAULT_AI_CONFIG: AiConfig = AiConfig.parse({
  provider: 'vertex',
  models: { main: 'gemini-3.8-flash', lite: 'gemini-3.5-flash-lite' },
})

export function loadAiConfig(configDir: string): AiConfig {
  return AiConfig.parse(JSON.parse(readFileSync(join(configDir, 'ai.json'), 'utf8')))
}
