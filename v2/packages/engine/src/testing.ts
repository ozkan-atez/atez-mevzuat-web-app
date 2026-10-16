import { eq } from 'drizzle-orm'
import { TERMINAL_RUN_STATUSES, SYSTEM_ACTOR, type Pool, type RunStatus } from '@atez/contracts'
import {
  OutboxRelay,
  assertTopology,
  buildTopology,
  connectAmqp,
  schema,
  type AmqpHandle,
  type Db,
  type DbHandle,
  type RetryTier,
} from '@atez/platform'
import { ensureVhost, openTestDb, purgeQueues, truncateAll } from '@atez/platform/testing'
import type { StepRegistry } from './handler'
import { Orchestrator } from './orchestrator'
import { RecipeRegistry } from './recipes'
import { startRun } from './runs'
import { StepWorker } from './worker'

/** Testlerde kısa retry kademeleri (yalnızca -test vhost'ta kurulur). */
export const TEST_RETRY_TIERS: RetryTier[] = [
  { label: 't300ms', delayMs: 300 },
  { label: 't600ms', delayMs: 600 },
  { label: 't1s', delayMs: 1000 },
]

export interface Harness<D> {
  db: DbHandle
  amqp: AmqpHandle
  recipes: RecipeRegistry
  worker: StepWorker<D>
  start(recipeKey: string, input: Record<string, unknown>, mode?: 'REUSE_ONLY' | 'FILL_MISSING' | 'FORCE', forceNodes?: string[]): Promise<string>
  waitForRun(runId: string, timeoutMs?: number): Promise<RunStatus>
  stop(): Promise<void>
}

/**
 * Gerçek Postgres (_test) + RabbitMQ (-test vhost) üzerinde relay, worker ve orkestratörü
 * çalıştıran uçtan uca test düzeneği.
 */
export async function startHarness<D>(opts: {
  steps: StepRegistry<D>
  /** Servisler test DB'sine ihtiyaç duyabilir; o yüzden fonksiyon da verilebilir. */
  deps: D | ((db: Db) => D)
  recipes: RecipeRegistry
  pools: Pool[]
  leaseMs?: number
}): Promise<Harness<D>> {
  const db = await openTestDb()
  await truncateAll(db)
  const amqpUrl = process.env.TEST_AMQP_URL!
  await ensureVhost(process.env.RABBITMQ_MANAGEMENT_URL!, amqpUrl)
  const amqp = await connectAmqp(amqpUrl)
  const ch = await amqp.connection.createChannel()
  await assertTopology(ch, buildTopology(TEST_RETRY_TIERS))
  await ch.close()
  await purgeQueues(process.env.RABBITMQ_MANAGEMENT_URL!, amqpUrl)

  const relay = new OutboxRelay(db.db, amqp.publisher, { idleMs: 25 })
  relay.start()
  const worker = new StepWorker<D>({ db: db.db, steps: opts.steps, deps: typeof opts.deps === 'function' ? (opts.deps as (db: Db) => D)(db.db) : opts.deps, owner: 'test-worker', retryTiers: TEST_RETRY_TIERS, leaseMs: opts.leaseMs ?? 30_000 })
  const stopWorker = await worker.consumePools(amqp.connection, opts.pools)
  const orchestrator = new Orchestrator(db.db)
  const stopOrch = await orchestrator.consume(amqp.connection)

  return {
    db,
    amqp,
    recipes: opts.recipes,
    worker,
    async start(recipeKey, input, mode = 'FILL_MISSING', forceNodes) {
      const r = await startRun(db.db, opts.recipes, { recipeKey, input, mode, forceNodes }, SYSTEM_ACTOR)
      return r.runId
    },
    async waitForRun(runId, timeoutMs = 30_000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const [r] = await db.db.select({ status: schema.run.status }).from(schema.run).where(eq(schema.run.id, runId))
        if (r && TERMINAL_RUN_STATUSES.includes(r.status as RunStatus)) return r.status as RunStatus
        await new Promise((res) => setTimeout(res, 50))
      }
      throw new Error(`run ${runId} zaman aşımı`)
    },
    async stop() {
      await stopWorker()
      await stopOrch()
      await relay.stop()
      await amqp.close()
      await db.close()
    },
  }
}
