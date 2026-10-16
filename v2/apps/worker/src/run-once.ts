import { hostname } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { eq, sql } from 'drizzle-orm'
import { SYSTEM_ACTOR, TERMINAL_RUN_STATUSES, type RunStatus } from '@atez/contracts'
import { Orchestrator, RecipeRegistry, StepWorker, startRun } from '@atez/engine'
import { OutboxRelay, POOLS, SafeHttpFetcher, bootRuntime, schema } from '@atez/platform'
import { buildStepRegistry, type StepDeps } from '@atez/steps'

/**
 * Geliştirici aracı: relay + bütün havuzlar + orkestratörü tek süreçte açar, bir tarif
 * çalıştırır ve özet basar. Örn.:
 *   pnpm run-once --recipe rg-daily-profile --date 2025-12-31
 */
const { values } = parseArgs({
  options: {
    recipe: { type: 'string', default: 'rg-daily-profile' },
    date: { type: 'string' },
    mode: { type: 'string', default: 'FILL_MISSING' },
    input: { type: 'string', default: '{}' },
    concurrency: { type: 'string', default: '1' },
  },
})
const rt = await bootRuntime('run-once')
await rt.store.ensureBucket()
const deps: StepDeps = {
  db: rt.db.db,
  store: rt.store,
  ai: rt.ai,
  configDir: rt.configDir,
  http: new SafeHttpFetcher({ allowedHosts: ['www.resmigazete.gov.tr', 'resmigazete.gov.tr'], minIntervalMs: 750, timeoutMs: 180_000 }),
}
const recipes = RecipeRegistry.fromDir(join(rt.configDir, 'recipes'))
const relay = new OutboxRelay(rt.db.db, rt.amqp.publisher, { idleMs: 50, logger: rt.log })
relay.start()
const worker = new StepWorker<StepDeps>({ db: rt.db.db, steps: buildStepRegistry(), deps, owner: `${hostname()}:${process.pid}`, logger: rt.log, prefetch: Number(values.concurrency) })
const stopWorker = await worker.consumePools(rt.amqp.connection, [...POOLS])
const stopOrch = await new Orchestrator(rt.db.db, rt.log).consume(rt.amqp.connection)

const aiCount = async () => (await rt.db.db.select({ n: sql<number>`count(*)::int` }).from(schema.aiCall))[0]!.n
const aiBefore = await aiCount()
const input = { ...JSON.parse(values.input!), ...(values.date ? { date: values.date } : {}) }
const started = Date.now()
const { runId } = await startRun(rt.db.db, recipes, { recipeKey: values.recipe, input, mode: values.mode }, SYSTEM_ACTOR)
let status: RunStatus = 'RUNNING'
while (!TERMINAL_RUN_STATUSES.includes(status)) {
  await new Promise((r) => setTimeout(r, 1000))
  status = (await rt.db.db.select({ s: schema.run.status }).from(schema.run).where(eq(schema.run.id, runId)))[0]!.s as RunStatus
}
const steps = await rt.db.db.select().from(schema.runStep).where(eq(schema.runStep.runId, runId))
const discover = await rt.db.db.select({ output: schema.workItem.output }).from(schema.workItem).where(sql`${schema.workItem.runId} = ${runId} AND ${schema.workItem.nodeId} = 'discover'`)
const failures = await rt.db.db
  .select({ node: schema.workItem.nodeId, error: schema.workItem.error })
  .from(schema.workItem)
  .where(sql`${schema.workItem.runId} = ${runId} AND ${schema.workItem.status} = 'FAILED'`)
const summary = {
  runId,
  status,
  seconds: Math.round((Date.now() - started) / 1000),
  aiCalls: (await aiCount()) - aiBefore,
  precheck: (discover[0]?.output as { precheck?: { status: string }; counts?: unknown } | undefined)?.precheck?.status,
  counts: (discover[0]?.output as { counts?: unknown } | undefined)?.counts,
  steps: Object.fromEntries(steps.map((s) => [s.nodeId, { total: s.total, ok: s.succeeded, failed: s.failed, skipped: s.skipped, cached: s.cached }])),
  failures: failures.slice(0, 10),
}
console.log(JSON.stringify(summary, null, 2))
await stopWorker()
await stopOrch()
await relay.stop()
await rt.close()
process.exit(0)
