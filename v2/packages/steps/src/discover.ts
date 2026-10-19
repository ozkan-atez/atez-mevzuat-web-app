import type { StepInput, StepOutput } from '@atez/contracts'
import type { StepHandler } from '@atez/engine'
import { PermanentError } from '@atez/platform'
import { RG_ADAPTER_VERSION, discoverResmiGazete, loadSourceDefinition } from '@atez/modules'
import type { StepDeps } from './deps'

/** `source.discover`: kaynak tanımı + tarih → belge adayları; ön kontrol (§5.3) burada. */
export const sourceDiscover: StepHandler<StepInput<'source.discover'>, StepOutput<'source.discover'>, StepDeps> = {
  key: 'source.discover',
  versions: () => ({ handler: '1', rgAdapter: RG_ADAPTER_VERSION }),
  // Canlı yoklama: sonuç önbelleğe alınmaz; tekrarı ön kontrol eler.
  cacheIdentity: () => null,
  async run(input, ctx) {
    const def = loadSourceDefinition(ctx.deps.configDir, input.sourceId)
    if (def.transport !== 'GAZETTE') throw new PermanentError(`Henüz desteklenmeyen taşıma: ${def.transport}`, 'TRANSPORT_UNSUPPORTED')
    return discoverResmiGazete({ db: ctx.deps.db, http: ctx.deps.http, log: ctx.log }, def.id, input.date, { force: ctx.mode === 'FORCE' })
  },
}
