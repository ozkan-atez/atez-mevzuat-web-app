import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

/** Bileşen havuzu ve şablonlar (§10.1). Sürümler değişmezdir. */
export const component = pgTable(
  'component',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    origin: text('origin').notNull(),
    status: text('status').notNull(),
    currentVersion: integer('current_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('component_key_uq').on(t.key), index('component_status_idx').on(t.status)],
)

export const componentVersion = pgTable(
  'component_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    componentId: uuid('component_id').notNull(),
    version: integer('version').notNull(),
    definition: jsonb('definition').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('component_version_uq').on(t.componentId, t.version)],
)

export const template = pgTable('template', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  status: text('status').notNull(), // ACTIVE | ARCHIVED
  isDefault: boolean('is_default').notNull().default(false),
  currentVersion: integer('current_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const templateVersion = pgTable(
  'template_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id').notNull(),
    version: integer('version').notNull(),
    definition: jsonb('definition').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('template_version_uq').on(t.templateId, t.version)],
)
