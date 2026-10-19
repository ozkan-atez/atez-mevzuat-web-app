import { hostname } from 'node:os'
import { parseArgs } from 'node:util'
import { Orchestrator, Reaper, StepWorker } from '@atez/engine'
import { POOLS, bootRuntime } from '@atez/platform'
import { buildStepRegistry, createStepDeps, type StepDeps } from '@atez/steps'
import type { Pool } from '@atez/contracts'

/**
 * `worker --pool=io,doc` · `worker --pool=orchestrator` · `worker --pool=all` (yerel geliştirme).
 * Orkestratör rolü reaper'ı da çalıştırır (birden çok örnek güvenli: SKIP LOCKED).
 */
const { values } = parseArgs({ options: { pool: { type: 'string', default: 'all' } } })
const requested = values.pool!.split(',').map((p) => p.trim())
const all = requested.includes('all')
const pools = (all ? POOLS : requested.filter((p) => (POOLS as readonly string[]).includes(p))) as Pool[]
const withOrchestrator = all || requested.includes('orchestrator')

const rt = await bootRuntime(`worker:${values.pool}`)
const deps: StepDeps = createStepDeps(rt)
if (!deps.tariff.configured) rt.log.warn('TARIFF kimlik bilgisi yok; önceki hal yalnızca RG aramasıyla aranır')
await rt.store.ensureBucket()
const worker = new StepWorker<StepDeps>({ db: rt.db.db, steps: buildStepRegistry(), deps, owner: `${hostname()}:${process.pid}`, logger: rt.log })
const stops: (() => Promise<void>)[] = []
if (pools.length) stops.push(await rt.amqp.subscribe((connection) => worker.consumePools(connection, pools)))
let reaper: Reaper | null = null
if (withOrchestrator) {
  const orchestrator = new Orchestrator(rt.db.db, rt.log)
  stops.push(await rt.amqp.subscribe((connection) => orchestrator.consume(connection)))
  reaper = new Reaper(rt.db.db, { logger: rt.log })
  reaper.start()
}
rt.log.info('worker started', { pools, orchestrator: withOrchestrator })

const shutdown = async () => {
  reaper?.stop()
  for (const s of stops) await s()
  await rt.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
