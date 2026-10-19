import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import {
  EVENT_TYPES,
  TERMINAL_ITEM_STATUSES,
  TERMINAL_RUN_STATUSES,
  WorkItemFinished,
  type Actor,
  type Envelope,
  type RecipeDefinition,
  type RecipeNode,
  type RunStatus,
  type StepKey,
} from '@atez/contracts'
import {
  ORCHESTRATOR_QUEUE,
  consume,
  enqueueEvent,
  markProcessed,
  schema,
  silentLogger,
  type ChannelModel,
  type ConsumeResult,
  type Db,
  type DbOrTx,
  type Logger,
} from '@atez/platform'
import { evaluateWhen, getPath, isStreaming, mergeWith, successorsOf, topoOrder } from './recipes'
import { createItems } from './runs'

const { run, runStep, workItem } = schema
const CONSUMER = 'orchestrator'

/**
 * Orkestratör (§12): olayları dinler, tarif grafiğine göre sonraki işleri üretir.
 *  - Öğe bazlı akış: tek önceki + bariyersiz düğümde X bitince X'in ardılı hemen başlar.
 *  - Bariyer: önceki düğümlerin tüm öğeleri bitip yönlendirilmeden başlamaz.
 *  - Tek öğenin hatası run'ı durdurmaz → COMPLETED_WITH_ERRORS.
 * Aynı run'ın olayları `run` satır kilidiyle sıralanır.
 */
export class Orchestrator {
  private readonly log: Logger
  constructor(private readonly db: Db, logger?: Logger) {
    this.log = logger ?? silentLogger
  }

  async consume(connection: ChannelModel): Promise<() => Promise<void>> {
    const sub = await consume(connection, ORCHESTRATOR_QUEUE, (env) => this.handle(env), { prefetch: 1, logger: this.log })
    return () => sub.cancel()
  }

  async handle(envelope: Envelope): Promise<ConsumeResult> {
    if (envelope.type !== EVENT_TYPES.workItemFinished) return 'ack'
    const ev = WorkItemFinished.safeParse(envelope.payload)
    if (!ev.success) return 'park'
    await this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(run).where(eq(run.id, ev.data.runId)).for('update')
      if (!r) return
      if (!(await markProcessed(tx, CONSUMER, envelope.messageId))) return
      if (TERMINAL_RUN_STATUSES.includes(r.status as RunStatus)) return
      const recipe = r.recipe as RecipeDefinition
      const actor = r.actor as Actor
      const [item] = await tx.select().from(workItem).where(eq(workItem.id, ev.data.workItemId))
      if (item && !item.routed && TERMINAL_ITEM_STATUSES.includes(item.status as never)) {
        if (item.status === 'SUCCEEDED') await this.routeItem(tx, recipe, r.id, r.input, actor, item)
        await tx.update(workItem).set({ routed: true }).where(eq(workItem.id, item.id))
      }
      await this.advance(tx, recipe, r.id, actor)
    })
    return 'ack'
  }

  /** Öğe bazlı ardılları üretir. */
  private async routeItem(tx: DbOrTx, recipe: RecipeDefinition, runId: string, runInput: unknown, actor: Actor, item: typeof workItem.$inferSelect) {
    for (const next of successorsOf(recipe, item.nodeId).filter(isStreaming)) {
      const elements = next.fanOut ? asArray(getPath(item.output, next.fanOut)) : [item.output]
      const items: { itemKey: string; input: unknown; parentItemId: string }[] = []
      let filtered = 0
      elements.forEach((el, idx) => {
        const input = mergeWith(el, next.with)
        if (!evaluateWhen(next.when, { item: input, run: runInput })) {
          filtered++
          return
        }
        items.push({ itemKey: next.fanOut ? `${item.itemKey}/${idx}` : item.itemKey, input, parentItemId: item.id })
      })
      await createItems(tx, { runId, actor, nodeId: next.id, stepKey: next.step as StepKey, items })
      if (filtered) await tx.update(runStep).set({ skipped: sql`${runStep.skipped} + ${filtered}` }).where(and(eq(runStep.runId, runId), eq(runStep.nodeId, next.id)))
    }
  }

  /** Düğüm kapanışlarını hesaplar, bariyer işlerini açar, run'ı bitirir. */
  async advance(tx: DbOrTx, recipe: RecipeDefinition, runId: string, actor: Actor): Promise<void> {
    const steps = await tx.select().from(runStep).where(eq(runStep.runId, runId))
    const closed = new Map(steps.map((s) => [s.nodeId, s.closed]))
    for (const node of topoOrder(recipe)) {
      if (closed.get(node.id)) continue
      if (!node.after.every((a) => closed.get(a))) continue
      const open = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(workItem)
        .where(and(eq(workItem.runId, runId), eq(workItem.nodeId, node.id), sql`(${workItem.routed} = false OR ${workItem.status} NOT IN ('SUCCEEDED','FAILED','CANCELLED','SKIPPED'))`))
      if (open[0]!.n > 0) continue
      if (!isStreaming(node) && node.after.length > 0) {
        const created = await this.openBarrier(tx, node, runId, actor)
        if (created) continue
      }
      await tx.update(runStep).set({ closed: true, closedAt: sql`now()` }).where(and(eq(runStep.runId, runId), eq(runStep.nodeId, node.id)))
      closed.set(node.id, true)
    }
    if ([...closed.values()].every(Boolean)) {
      const failed = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(workItem)
        .where(and(eq(workItem.runId, runId), eq(workItem.status, 'FAILED')))
      const status: RunStatus = failed[0]!.n > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED'
      await tx.update(run).set({ status, finishedAt: sql`now()` }).where(eq(run.id, runId))
      await enqueueEvent(tx, { type: EVENT_TYPES.runFinished, runId, idempotencyKey: `${runId}:finished`, actor, payload: { runId, status } })
      this.log.info('run finished', { runId, status })
    }
  }

  /** Bariyer düğümü için tek iş açar; açtıysa true. Zaten açılmışsa (iş var) false döner. */
  private async openBarrier(tx: DbOrTx, node: RecipeNode, runId: string, actor: Actor): Promise<boolean> {
    const existing = await tx.select({ id: workItem.id }).from(workItem).where(and(eq(workItem.runId, runId), eq(workItem.nodeId, node.id))).limit(1)
    if (existing.length) return false
    const preds = await tx
      .select({ output: workItem.output })
      .from(workItem)
      .where(and(eq(workItem.runId, runId), inArray(workItem.nodeId, node.after), eq(workItem.status, 'SUCCEEDED')))
      .orderBy(asc(workItem.nodeId), asc(workItem.itemKey))
    if (preds.length === 0) return false
    const n = await createItems(tx, { runId, actor, nodeId: node.id, stepKey: node.step as StepKey, items: [{ itemKey: '*', input: preds.map((p) => p.output), parentItemId: null }] })
    return n > 0
  }
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])
