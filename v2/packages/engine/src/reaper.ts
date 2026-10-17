import { and, eq, sql } from 'drizzle-orm'
import { EVENT_TYPES, type Actor } from '@atez/contracts'
import { enqueueEvent, enqueueStepCommand, schema, silentLogger, type Db, type Logger } from '@atez/platform'

const { run, runStep, workItem } = schema

/**
 * Reaper (§12): lease süresi dolan işleri yeniden kuyruğa koyar. Deneme hakkı bittiyse
 * FAILED yazar ve olay yayınlar (run durmaz).
 */
export class Reaper {
  private timer: NodeJS.Timeout | null = null
  constructor(private readonly db: Db, private readonly opts: { intervalMs?: number; graceMs?: number; logger?: Logger } = {}) {}

  async sweep(): Promise<{ requeued: number; failed: number }> {
    const log = this.opts.logger ?? silentLogger
    const grace = this.opts.graceMs ?? 0
    return this.db.transaction(async (tx) => {
      const expired = await tx.execute<{ id: string; run_id: string; node_id: string; step_key: string; attempt: number; max_attempts: number; fence: number }>(sql`
        SELECT id, run_id, node_id, step_key, attempt, max_attempts, fence FROM work_item
        WHERE status = 'RUNNING' AND lease_until < now() - ${`${grace} milliseconds`}::interval
        ORDER BY lease_until LIMIT 100 FOR UPDATE SKIP LOCKED`)
      let requeued = 0
      let failed = 0
      for (const it of expired.rows) {
        const [r] = await tx.select({ actor: run.actor }).from(run).where(eq(run.id, it.run_id))
        const actor = r!.actor as Actor
        if (it.attempt < it.max_attempts) {
          await tx
            .update(workItem)
            .set({ status: 'RETRY_SCHEDULED', leaseOwner: null, leaseUntil: null, error: { code: 'LEASE_EXPIRED', attempt: it.attempt } })
            .where(eq(workItem.id, it.id))
          await enqueueStepCommand(tx, { payload: { runId: it.run_id, workItemId: it.id, stepKey: it.step_key }, actor, attempt: it.attempt + 1 })
          requeued++
        } else {
          await tx
            .update(workItem)
            .set({ status: 'FAILED', leaseOwner: null, leaseUntil: null, finishedAt: sql`now()`, error: { code: 'LEASE_EXPIRED', attempt: it.attempt } })
            .where(eq(workItem.id, it.id))
          await tx.update(runStep).set({ failed: sql`${runStep.failed} + 1` }).where(and(eq(runStep.runId, it.run_id), eq(runStep.nodeId, it.node_id)))
          await enqueueEvent(tx, {
            type: EVENT_TYPES.workItemFinished,
            runId: it.run_id,
            idempotencyKey: `${it.id}:reaped:${it.fence}`,
            actor,
            payload: { runId: it.run_id, workItemId: it.id, nodeId: it.node_id, status: 'FAILED', outcome: null },
          })
          failed++
        }
      }
      if (requeued || failed) log.warn('reaper swept expired leases', { requeued, failed })
      return { requeued, failed }
    })
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.sweep().catch(() => {}), this.opts.intervalMs ?? 30_000)
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
