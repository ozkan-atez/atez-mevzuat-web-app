import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

/** İş motoru tabloları (§3 İş Motoru): run / run_step / work_item / step_result. */

export const run = pgTable('run', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeKey: text('recipe_key').notNull(),
  recipeVersion: integer('recipe_version').notNull(),
  /** Run başladığı andaki tarif anlık görüntüsü; tarif sonradan değişse de run tutarlı kalır. */
  recipe: jsonb('recipe').notNull(),
  mode: text('mode').notNull(),
  forceNodes: jsonb('force_nodes').$type<string[] | null>(),
  input: jsonb('input').notNull(),
  actor: jsonb('actor').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
})

export const runStep = pgTable(
  'run_step',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    stepKey: text('step_key').notNull(),
    total: integer('total').notNull().default(0),
    succeeded: integer('succeeded').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    cached: integer('cached').notNull().default(0),
    closed: boolean('closed').notNull().default(false),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('run_step_run_node_uq').on(t.runId, t.nodeId)],
)

export const workItem = pgTable(
  'work_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    stepKey: text('step_key').notNull(),
    /** Run + düğüm içinde öğe kimliği; çift oluşturmayı engeller. Bariyer işlerinde `*`. */
    itemKey: text('item_key').notNull(),
    parentItemId: uuid('parent_item_id'),
    input: jsonb('input').notNull(),
    status: text('status').notNull(),
    outcome: text('outcome'),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    leaseOwner: text('lease_owner'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    /** Lease jetonu: her alımda artar; sonuç yalnızca jeton tutuyorsa yazılır. */
    fence: integer('fence').notNull().default(0),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    cacheKey: text('cache_key'),
    stepResultId: uuid('step_result_id'),
    output: jsonb('output'),
    error: jsonb('error'),
    /** Orkestratör ardıl işleri bu öğe için üretti mi? Düğüm kapanışı buna bakar. */
    routed: boolean('routed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('work_item_run_node_key_uq').on(t.runId, t.nodeId, t.itemKey),
    index('work_item_lease_idx').on(t.status, t.leaseUntil),
    index('work_item_run_idx').on(t.runId, t.nodeId, t.status),
  ],
)

/**
 * Adım sonucu önbelleği (§5.3 basamak 3). Anahtar: adım + girdi hash'i + prompt/model/config
 * sürümleri. FORCE yeni bir `version` üretir, eskisi korunur.
 */
export const stepResult = pgTable(
  'step_result',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stepKey: text('step_key').notNull(),
    cacheKey: text('cache_key').notNull(),
    version: integer('version').notNull(),
    output: jsonb('output').notNull(),
    versions: jsonb('versions').notNull(),
    workItemId: uuid('work_item_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('step_result_key_version_uq').on(t.cacheKey, t.version)],
)

