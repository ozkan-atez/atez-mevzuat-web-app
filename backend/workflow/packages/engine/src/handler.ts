import type { Actor, RunMode, StepKey } from '@atez/contracts'
import type { Logger } from '@atez/platform'

export interface StepContext<D = unknown> {
  runId: string
  workItemId: string
  nodeId: string
  stepKey: StepKey
  mode: RunMode
  /** FORCE bu düğüm için geçerli mi? (yeni sürüm üretilecek) */
  force: boolean
  runInput: Record<string, unknown>
  actor: Actor
  attempt: number
  /** Bu öğe için toplam deneme hakkı; son denemede adımlar geçici hatayı sonuç olarak yazabilir. */
  maxAttempts: number
  log: Logger
  /** Lease kaybedilirse iptal edilir. */
  signal: AbortSignal
  deps: D
}

/**
 * Genel adım (§5.1, §13 `steps/`). Adım kendi önbellek kimliğini ve sürümlerini bildirir;
 * motor `step_result` önbelleğini, modları ve kaydı yönetir.
 */
export interface StepHandler<I = any, O = any, D = any> {
  key: StepKey
  /** Prompt/model/adapter/config sürümleri — biri değişince önbellek anahtarı değişir. */
  versions(ctx: StepContext<D>): Record<string, string>
  /**
   * Girdinin içerik kimliği. Varsayılan: girdinin kanonik JSON hash'i. `null` → bu girdi için
   * önbellek kullanılmaz (adım kendi içinde öğe bazlı yeniden kullanım yapıyorsa).
   */
  cacheIdentity?(input: I, ctx: StepContext<D>): Promise<string | null> | string | null
  run(input: I, ctx: StepContext<D>): Promise<O>
}

export class StepRegistry<D = unknown> {
  private readonly handlers = new Map<string, StepHandler<any, any, D>>()
  register(...handlers: StepHandler<any, any, D>[]): this {
    for (const h of handlers) {
      if (this.handlers.has(h.key)) throw new Error(`Adım iki kez kaydedildi: ${h.key}`)
      this.handlers.set(h.key, h)
    }
    return this
  }
  get(key: string): StepHandler<any, any, D> | undefined {
    return this.handlers.get(key)
  }
  keys(): string[] {
    return [...this.handlers.keys()]
  }
}
