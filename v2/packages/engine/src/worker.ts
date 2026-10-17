import { and, desc, eq, sql } from 'drizzle-orm'
import {
  ExecuteStepPayload,
  EVENT_TYPES,
  STEP_CATALOG,
  isStepKey,
  type Actor,
  type Envelope,
  type RunMode,
  type StepKey,
  type WorkItemOutcome,
  type WorkItemStatus,
} from '@atez/contracts'
import {
  EXCHANGES,
  PermanentError,
  TransientError,
  alreadyProcessed,
  canonicalJson,
  consume,
  DEFAULT_RETRY_TIERS,
  enqueue,
  enqueueEvent,
  enqueueStepCommand,
  errorInfo,
  hashJson,
  markProcessed,
  poolQueue,
  retryTierFor,
  schema,
  sha256,
  silentLogger,
  type ChannelModel,
  type ConsumeResult,
  type Db,
  type DbOrTx,
  type Logger,
  type RetryTier,
} from '@atez/platform'
import type { Pool } from '@atez/contracts'
import type { StepContext, StepRegistry } from './handler'
import { isForced } from './runs'

const { run, runStep, stepResult, workItem } = schema

export interface WorkerOptions<D> {
  db: Db
  steps: StepRegistry<D>
  deps: D
  owner: string
  leaseMs?: number
  /** Kuyruk başına eşzamanlı iş (varsayılan 1, Ek B.2 `prefetch(1)`). */
  prefetch?: number
  retryTiers?: readonly RetryTier[]
  logger?: Logger
}

class LostLease extends Error {}

/**
 * Havuz worker'ı (§12 tüketici döngüsü):
 *  1 zarf doğrula → 2 inbox → 3 lease ile al → 4 step_result önbelleği → 5 iş + heartbeat →
 *  6 tek transaction: sonuç, step_result, durum, inbox, olay (outbox) → 7 ack.
 */
export class StepWorker<D> {
  private readonly log: Logger
  private readonly leaseMs: number
  private readonly tiers: readonly RetryTier[]
  private readonly consumer: string

  constructor(private readonly opts: WorkerOptions<D>) {
    this.log = opts.logger ?? silentLogger
    this.leaseMs = opts.leaseMs ?? 5 * 60_000
    this.tiers = opts.retryTiers ?? DEFAULT_RETRY_TIERS
    this.consumer = 'worker'
  }

  async consumePools(connection: ChannelModel, pools: Pool[]): Promise<() => Promise<void>> {
    // ai-lite ve ai-main aynı kuyruğu paylaşır; her kuyruğa bir kez abone olunur.
    const queues = [...new Set(pools.map(poolQueue))]
    const subs = await Promise.all(queues.map((q) => consume(connection, q, (env) => this.handle(env), { prefetch: this.opts.prefetch ?? 1, logger: this.log })))
    return async () => {
      for (const s of subs) await s.cancel()
    }
  }

  async handle(envelope: Envelope): Promise<ConsumeResult> {
    const { db } = this.opts
    const parsed = ExecuteStepPayload.safeParse(envelope.payload)
    if (!parsed.success) return 'park'
    const { workItemId, runId } = parsed.data
    if (await alreadyProcessed(db, this.consumer, envelope.messageId)) return 'ack'

    // 3. Lease: yalnızca hazır, retry bekleyen ya da lease'i dolmuş iş alınır (çift teslim bastırılır).
    const leased = await db
      .update(workItem)
      .set({
        status: 'RUNNING',
        leaseOwner: this.opts.owner,
        leaseUntil: sql`now() + ${`${this.leaseMs} milliseconds`}::interval`,
        heartbeatAt: sql`now()`,
        fence: sql`${workItem.fence} + 1`,
        attempt: sql`${workItem.attempt} + 1`,
        startedAt: sql`coalesce(${workItem.startedAt}, now())`,
      })
      .where(
        and(
          eq(workItem.id, workItemId),
          sql`(${workItem.status} IN ('READY','RETRY_SCHEDULED') OR (${workItem.status} = 'RUNNING' AND ${workItem.leaseUntil} < now()))`,
        ),
      )
      .returning()
    const item = leased[0]
    if (!item) return 'ack'
    const [runRow] = await db.select().from(run).where(eq(run.id, runId))
    if (!runRow) return 'park'
    const log = this.log.child({ runId, workItemId, step: item.stepKey, attempt: item.attempt })
    const fence = item.fence
    const actor = runRow.actor as Actor

    const abort = new AbortController()
    const heartbeat = setInterval(() => {
      db.update(workItem)
        .set({ leaseUntil: sql`now() + ${`${this.leaseMs} milliseconds`}::interval`, heartbeatAt: sql`now()` })
        .where(and(eq(workItem.id, workItemId), eq(workItem.fence, fence), eq(workItem.status, 'RUNNING')))
        .returning({ id: workItem.id })
        .then((rows) => {
          if (rows.length === 0) abort.abort(new LostLease('lease lost'))
        })
        .catch((err) => log.warn('heartbeat failed', { error: String(err) }))
    }, Math.max(1000, Math.floor(this.leaseMs / 3)))

    try {
      const result = await this.execute(item, runRow.mode as RunMode, runRow.forceNodes, runRow.input as Record<string, unknown>, actor, abort.signal, log)
      await db.transaction(async (tx) => {
        let stepResultId: string | null = result.cachedResultId
        if (result.outcome === 'EXECUTED' && result.cacheKey) stepResultId = await insertStepResult(tx, item.stepKey, result.cacheKey, result.output, result.versions, item.id)
        await this.finish(tx, item, fence, actor, envelope, {
          status: result.status,
          outcome: result.outcome,
          output: result.output,
          cacheKey: result.cacheKey,
          stepResultId,
          error: null,
        })
      })
      log.info('work item finished', { status: result.status, outcome: result.outcome })
      return 'ack'
    } catch (err) {
      if (err instanceof LostLease || abort.signal.aborted) {
        log.warn('lease lost; result discarded')
        return 'ack'
      }
      return this.fail(item, fence, actor, envelope, err, log)
    } finally {
      clearInterval(heartbeat)
    }
  }

  private async execute(
    item: typeof workItem.$inferSelect,
    mode: RunMode,
    forceNodes: string[] | null,
    runInput: Record<string, unknown>,
    actor: Actor,
    signal: AbortSignal,
    log: Logger,
  ): Promise<{ status: WorkItemStatus; outcome: WorkItemOutcome; output: unknown; cacheKey: string | null; cachedResultId: string | null; versions: Record<string, string> }> {
    if (!isStepKey(item.stepKey)) throw new PermanentError(`Katalogda olmayan adım: ${item.stepKey}`, 'UNKNOWN_STEP')
    const stepKey: StepKey = item.stepKey
    const handler = this.opts.steps.get(stepKey)
    if (!handler) throw new PermanentError(`Bu worker'da adım işleyicisi yok: ${stepKey}`, 'NO_HANDLER')
    const contract = STEP_CATALOG[stepKey]
    const input = contract.input.safeParse(item.input)
    if (!input.success) throw new PermanentError(`Adım girdisi geçersiz: ${input.error.message}`, 'INVALID_INPUT')

    const force = isForced(mode, forceNodes, item.nodeId)
    const ctx: StepContext<D> = {
      runId: item.runId,
      workItemId: item.id,
      nodeId: item.nodeId,
      stepKey,
      mode,
      force,
      runInput,
      actor,
      attempt: item.attempt,
      maxAttempts: item.maxAttempts,
      log,
      signal,
      deps: this.opts.deps,
    }
    const versions = handler.versions(ctx)
    const identity = handler.cacheIdentity ? await handler.cacheIdentity(input.data, ctx) : hashJson(input.data)
    const cacheKey = identity === null ? null : sha256(canonicalJson({ step: stepKey, versions, identity }))

    if (cacheKey && !force) {
      const [cached] = await this.opts.db
        .select({ id: stepResult.id, output: stepResult.output })
        .from(stepResult)
        .where(eq(stepResult.cacheKey, cacheKey))
        .orderBy(desc(stepResult.version))
        .limit(1)
      if (cached) return { status: 'SUCCEEDED', outcome: 'FROM_CACHE', output: cached.output, cacheKey, cachedResultId: cached.id, versions }
    }
    if (mode === 'REUSE_ONLY' && contract.external) {
      return { status: 'SKIPPED', outcome: 'MISSING', output: null, cacheKey, cachedResultId: null, versions }
    }
    const raw = await handler.run(input.data, ctx)
    const output = contract.output.safeParse(raw)
    if (!output.success) throw new PermanentError(`Adım çıktısı sözleşmeye uymuyor: ${output.error.message}`, 'INVALID_OUTPUT')
    return { status: 'SUCCEEDED', outcome: 'EXECUTED', output: output.data, cacheKey, cachedResultId: null, versions }
  }

  private async finish(
    tx: DbOrTx,
    item: typeof workItem.$inferSelect,
    fence: number,
    actor: Actor,
    envelope: Envelope,
    r: { status: WorkItemStatus; outcome: WorkItemOutcome | null; output: unknown; cacheKey: string | null; stepResultId: string | null; error: unknown },
  ): Promise<void> {
    const updated = await tx
      .update(workItem)
      .set({
        status: r.status,
        outcome: r.outcome,
        output: r.output ?? null,
        cacheKey: r.cacheKey,
        stepResultId: r.stepResultId,
        error: r.error ?? null,
        leaseOwner: null,
        leaseUntil: null,
        finishedAt: sql`now()`,
      })
      .where(and(eq(workItem.id, item.id), eq(workItem.fence, fence), eq(workItem.status, 'RUNNING')))
      .returning({ id: workItem.id })
    if (updated.length === 0) throw new LostLease('fence mismatch at commit')
    await tx
      .update(runStep)
      .set({
        succeeded: sql`${runStep.succeeded} + ${r.status === 'SUCCEEDED' ? 1 : 0}`,
        failed: sql`${runStep.failed} + ${r.status === 'FAILED' ? 1 : 0}`,
        skipped: sql`${runStep.skipped} + ${r.status === 'SKIPPED' ? 1 : 0}`,
        cached: sql`${runStep.cached} + ${r.outcome === 'FROM_CACHE' ? 1 : 0}`,
      })
      .where(and(eq(runStep.runId, item.runId), eq(runStep.nodeId, item.nodeId)))
    await markProcessed(tx, this.consumer, envelope.messageId)
    await enqueueEvent(tx, {
      type: EVENT_TYPES.workItemFinished,
      runId: item.runId,
      idempotencyKey: `${item.id}:${fence}`,
      actor,
      payload: { runId: item.runId, workItemId: item.id, nodeId: item.nodeId, status: r.status, outcome: r.outcome },
    })
  }

  private async fail(item: typeof workItem.$inferSelect, fence: number, actor: Actor, envelope: Envelope, err: unknown, log: Logger): Promise<ConsumeResult> {
    const info = errorInfo(err)
    const permanent = err instanceof PermanentError
    const canRetry = !permanent && item.attempt < item.maxAttempts
    try {
      await this.opts.db.transaction(async (tx) => {
        if (canRetry) {
          const tier = retryTierFor(this.tiers, item.attempt)
          const updated = await tx
            .update(workItem)
            .set({ status: 'RETRY_SCHEDULED', error: { ...info, attempt: item.attempt }, leaseOwner: null, leaseUntil: null })
            .where(and(eq(workItem.id, item.id), eq(workItem.fence, fence), eq(workItem.status, 'RUNNING')))
            .returning({ id: workItem.id })
          if (updated.length === 0) throw new LostLease('fence mismatch at retry')
          await markProcessed(tx, this.consumer, envelope.messageId)
          await enqueueStepCommand(tx, { payload: { runId: item.runId, workItemId: item.id, stepKey: item.stepKey }, actor, attempt: item.attempt + 1, retry: tier })
          log.warn('work item retry scheduled', { error: info, delay: tier.label })
        } else {
          await this.finish(tx, item, fence, actor, envelope, { status: 'FAILED', outcome: null, output: null, cacheKey: null, stepResultId: null, error: { ...info, attempt: item.attempt } })
          // Kalıcı hata kaydı: yeniden oynatma aracı için q.parking'e bir kopya.
          await enqueue(tx, EXCHANGES.dlx, 'parked', { ...envelope, messageId: crypto.randomUUID(), payload: { ...envelope.payload, error: info } })
          log.error('work item failed', { error: info })
        }
      })
    } catch (e) {
      if (e instanceof LostLease) return 'ack'
      throw e
    }
    return 'ack'
  }
}

async function insertStepResult(tx: DbOrTx, stepKey: string, cacheKey: string, output: unknown, versions: Record<string, string>, workItemId: string): Promise<string> {
  for (let i = 0; i < 3; i++) {
    const rows = await tx
      .insert(stepResult)
      .values({
        stepKey,
        cacheKey,
        version: sql`(SELECT coalesce(max(version), 0) + 1 FROM step_result WHERE cache_key = ${cacheKey})`,
        output: output as object,
        versions,
        workItemId,
      })
      .onConflictDoNothing()
      .returning({ id: stepResult.id })
    if (rows[0]) return rows[0].id
  }
  throw new TransientError('step_result sürüm çakışması', 'STEP_RESULT_CONFLICT')
}

