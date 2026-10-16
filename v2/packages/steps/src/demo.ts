import { PermanentError, TransientError } from '@atez/platform'
import type { StepHandler } from '@atez/engine'
import type { StepInput, StepOutput } from '@atez/contracts'

/**
 * Örnek adımlar — Aşama 1 iskeletinin uçtan uca testi için. `demo.upper` dış çağrı yapan bir
 * adımı taklit eder (REUSE_ONLY testinde çalıştırılmaz). "flaky" bir kez geçici hata,
 * "boom" kalıcı hata üretir.
 */
export interface DemoDeps {
  flakySeen?: Set<string>
  delayMs?: number
}

export const demoSplit: StepHandler<StepInput<'demo.split'>, StepOutput<'demo.split'>> = {
  key: 'demo.split',
  versions: () => ({ handler: '1' }),
  async run(input) {
    return { words: input.text.split(/\s+/).filter(Boolean) }
  },
}

export const demoUpper: StepHandler<StepInput<'demo.upper'>, StepOutput<'demo.upper'>, { demo?: DemoDeps }> = {
  key: 'demo.upper',
  versions: () => ({ handler: '1' }),
  async run(input, ctx) {
    const demo = ctx.deps.demo ?? {}
    if (demo.delayMs) await new Promise((r) => setTimeout(r, demo.delayMs))
    if (input === 'boom') throw new PermanentError('boom', 'DEMO_BOOM')
    if (input.startsWith('flaky')) {
      demo.flakySeen ??= new Set()
      if (!demo.flakySeen.has(`${ctx.runId}:${input}`)) {
        demo.flakySeen.add(`${ctx.runId}:${input}`)
        throw new TransientError('flaky once', 'DEMO_FLAKY')
      }
    }
    return { value: input.toUpperCase() }
  },
}

export const demoJoin: StepHandler<StepInput<'demo.join'>, StepOutput<'demo.join'>> = {
  key: 'demo.join',
  versions: () => ({ handler: '1' }),
  async run(input) {
    return { text: input.map((p) => p.value).join(' '), count: input.length }
  },
}
