import { index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Her AI çağrısı tek kayıt (§11, Ek B.2 kullanım defteri). Token alanlarında `null`
 * "ölçülmedi" demektir, 0 değildir. Maliyet fiyat tablosu verildiyse hesaplanır.
 */
export const aiCall = pgTable(
  'ai_call',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id'),
    workItemId: uuid('work_item_id'),
    stepKey: text('step_key'),
    purpose: text('purpose').notNull(),
    tier: text('tier').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    location: text('location'),
    promptVersion: text('prompt_version').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status').notNull(),
    errorKind: text('error_kind'),
    errorMessage: text('error_message'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cachedTokens: integer('cached_tokens'),
    thinkingTokens: integer('thinking_tokens'),
    latencyMs: integer('latency_ms').notNull(),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    responseKey: text('response_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_call_run_idx').on(t.runId), index('ai_call_created_idx').on(t.createdAt)],
)
