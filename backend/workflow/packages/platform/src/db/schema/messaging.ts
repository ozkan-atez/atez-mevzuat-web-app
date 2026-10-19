import { sql } from 'drizzle-orm'
import { bigserial, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid, index } from 'drizzle-orm/pg-core'

/** Tek Outbox (§2 ilke 7): durum değişikliği ile yayınlanacak mesaj aynı transaction'da yazılır. */
export const outbox = pgTable(
  'outbox',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    messageId: uuid('message_id').notNull().unique(),
    exchange: text('exchange').notNull(),
    routingKey: text('routing_key').notNull(),
    envelope: jsonb('envelope').notNull(),
    headers: jsonb('headers').$type<Record<string, string | number>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishAttempts: integer('publish_attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [index('outbox_unpublished_idx').on(t.id).where(sql`published_at IS NULL`)],
)

/** Tek Inbox: tüketici + messageId ile idempotent tüketim. */
export const inbox = pgTable(
  'inbox',
  {
    consumer: text('consumer').notNull(),
    messageId: uuid('message_id').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.consumer, t.messageId] })],
)
