import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { COMMAND_TYPES, type Actor, type Envelope, type ExecuteStepPayload } from '@atez/contracts'
import type { DbOrTx } from '../db/client'
import { inbox, outbox } from '../db/schema/messaging'
import { EXCHANGES, RETRY_HEADER, stepRoutingKey, type RetryTier } from './topology'

export function makeEnvelope(args: {
  type: string
  correlationId: string
  idempotencyKey: string
  attempt?: number
  actor: Actor
  payload: Record<string, unknown>
}): Envelope {
  return {
    messageId: randomUUID(),
    type: args.type,
    correlationId: args.correlationId,
    idempotencyKey: args.idempotencyKey,
    attempt: args.attempt ?? 1,
    actor: args.actor,
    occurredAt: new Date().toISOString(),
    payload: args.payload,
  }
}

/** Outbox'a yazar; durum değişikliğiyle aynı transaction içinde çağrılmalıdır. */
export async function enqueue(
  tx: DbOrTx,
  exchange: string,
  routingKey: string,
  envelope: Envelope,
  headers?: Record<string, string | number>,
): Promise<void> {
  await tx.insert(outbox).values({ messageId: envelope.messageId, exchange, routingKey, envelope, headers: headers ?? null })
}

export async function enqueueStepCommand(
  tx: DbOrTx,
  args: { payload: ExecuteStepPayload; actor: Actor; attempt: number; retry?: RetryTier },
): Promise<Envelope> {
  const env = makeEnvelope({
    type: COMMAND_TYPES.executeStep,
    correlationId: args.payload.runId,
    idempotencyKey: `${args.payload.workItemId}:${args.attempt}`,
    attempt: args.attempt,
    actor: args.actor,
    payload: args.payload,
  })
  if (args.retry) await enqueue(tx, EXCHANGES.retry, stepRoutingKey(args.payload.stepKey), env, { [RETRY_HEADER]: args.retry.label })
  else await enqueue(tx, EXCHANGES.cmd, stepRoutingKey(args.payload.stepKey), env)
  return env
}

export async function enqueueEvent(
  tx: DbOrTx,
  args: { type: string; runId: string; idempotencyKey: string; actor: Actor; payload: Record<string, unknown> },
): Promise<void> {
  const env = makeEnvelope({ type: args.type, correlationId: args.runId, idempotencyKey: args.idempotencyKey, actor: args.actor, payload: args.payload })
  await enqueue(tx, EXCHANGES.evt, args.type, env)
}

/** Inbox: bu tüketici bu mesajı daha önce işledi mi? */
export async function alreadyProcessed(tx: DbOrTx, consumer: string, messageId: string): Promise<boolean> {
  const rows = await tx.select({ m: inbox.messageId }).from(inbox).where(and(eq(inbox.consumer, consumer), eq(inbox.messageId, messageId))).limit(1)
  return rows.length > 0
}

/** Inbox kaydı; sonuçla aynı transaction'da yazılır. Çakışmada false döner. */
export async function markProcessed(tx: DbOrTx, consumer: string, messageId: string): Promise<boolean> {
  const rows = await tx.insert(inbox).values({ consumer, messageId }).onConflictDoNothing().returning({ m: inbox.messageId })
  return rows.length > 0
}
