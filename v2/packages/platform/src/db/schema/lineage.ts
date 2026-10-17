import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

/**
 * Bağımlılık / önceki hal (§7), konular (§3) ve GTİP değerleri. `from` her zaman mevcut belgedir;
 * `to` ya önceki bir belge sürümü ya da bir TARIFF anlık görüntüsüdür.
 */
export const tariffSnapshot = pgTable(
  'tariff_snapshot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gtip: text('gtip').notNull(),
    queryDate: text('query_date').notNull(),
    url: text('url').notNull(),
    sha256: text('sha256').notNull(),
    objectKey: text('object_key').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tariff_snapshot_uq').on(t.gtip, t.queryDate, t.sha256), index('tariff_snapshot_lookup_idx').on(t.gtip, t.queryDate)],
)

/** Paylaşılan TARIFF (Keycloak) belirteci; şifreli saklanır, süreç belleğinde değil. */
export const providerToken = pgTable('provider_token', {
  accountKey: text('account_key').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const documentRelation = pgTable(
  'document_relation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromVersionId: uuid('from_version_id').notNull(),
    relation: text('relation').notNull(),
    toVersionId: uuid('to_version_id'),
    toTariffSnapshotId: uuid('to_tariff_snapshot_id'),
    strategy: text('strategy').notNull(),
    ambiguous: integer('ambiguous').notNull().default(0),
    detail: jsonb('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('document_relation_from_idx').on(t.fromVersionId),
    uniqueIndex('document_relation_uq').on(t.fromVersionId, t.relation, t.toVersionId, t.toTariffSnapshotId),
  ],
)

/** Her strateji denemesinin kaydı (TARIFF, RG araması) — "neden bulunamadı?" sorusu için. */
export const resolutionAttempt = pgTable(
  'resolution_attempt',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentVersionId: uuid('document_version_id').notNull(),
    strategy: text('strategy').notNull(),
    status: text('status').notNull(),
    detail: jsonb('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('resolution_attempt_dv_idx').on(t.documentVersionId)],
)

/** `extract.table` satırları ve TARIFF'ten okunan önceki değerler (gtip_value adayı, §6.3). */
export const gtipValue = pgTable(
  'gtip_value',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentVersionId: uuid('document_version_id'),
    tariffSnapshotId: uuid('tariff_snapshot_id'),
    source: text('source').notNull(), // RG | TARIFF
    tableTitle: text('table_title'),
    gtip: text('gtip').notNull(),
    description: text('description'),
    value: text('value'), // ondalık string ("1234.56"); null = metinsel değer
    rawValue: text('raw_value'),
    unit: text('unit'),
    currency: text('currency'),
    origin: text('origin'),
    page: integer('page'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('gtip_value_dv_idx').on(t.documentVersionId), index('gtip_value_gtip_idx').on(t.gtip)],
)

export const topic = pgTable('topic', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  primaryVersionId: uuid('primary_version_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const topicMember = pgTable(
  'topic_member',
  {
    topicId: uuid('topic_id').notNull(),
    documentVersionId: uuid('document_version_id').notNull(),
    role: text('role').notNull(), // PRIMARY | SUPPORTING | SIGNAL
    matchedBy: text('matched_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.topicId, t.documentVersionId] }), uniqueIndex('topic_member_dv_uq').on(t.documentVersionId)],
)

export const analysis = pgTable(
  'analysis',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topicId: uuid('topic_id').notNull(),
    revision: integer('revision').notNull(),
    status: text('status').notNull(), // OK | REVIEW
    objectKey: text('object_key').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('analysis_topic_rev_uq').on(t.topicId, t.revision)],
)

/** K1: onay adımı yok; raporlar READY ("Gönderime hazır") olarak oluşur. */
export const report = pgTable(
  'report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    topicId: uuid('topic_id').notNull(),
    status: text('status').notNull(),
    title: text('title').notNull(),
    card: text('card').notNull(),
    currentRevision: integer('current_revision').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('report_topic_uq').on(t.topicId)],
)

export const reportRevision = pgTable(
  'report_revision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id').notNull(),
    revision: integer('revision').notNull(),
    analysisId: uuid('analysis_id').notNull(),
    specKey: text('spec_key').notNull(),
    htmlKey: text('html_key'),
    validation: jsonb('validation'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('report_revision_uq').on(t.reportId, t.revision)],
)
