import { date, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

/**
 * Belge modeli (§4.1). Büyük JSON'lar MinIO'da; burada yalnızca metadata, ilişkiler ve
 * profilin sorgulanabilir alanları.
 */

/** Kaynak düzeyi ön kontrol gözlemi (§5.3 basamak 0), ör. RG günü + mükerrer sayısı. */
export const sourceObservation = pgTable(
  'source_observation',
  {
    sourceId: text('source_id').notNull(),
    scopeKey: text('scope_key').notNull(),
    observed: jsonb('observed').notNull(),
    observedHash: text('observed_hash').notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.scopeKey] })],
)

export const document = pgTable(
  'document',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: text('source_id').notNull(),
    canonicalKey: text('canonical_key').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    kind: text('kind').notNull(),
    publishedOn: date('published_on'),
    listContext: jsonb('list_context'),
    /** DISCOVERED → TITLE_OUT | FETCHED → PROFILED. Ön kontrol (basamak 1) buna bakar. */
    processingState: text('processing_state').notNull(),
    titleDecision: text('title_decision'),
    titleReason: text('title_reason'),
    titleDecidedBy: text('title_decided_by'),
    latestVersionId: uuid('latest_version_id'),
    etag: text('etag'),
    lastModified: text('last_modified'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('document_source_key_uq').on(t.sourceId, t.canonicalKey), index('document_published_idx').on(t.sourceId, t.publishedOn)],
)

export const documentVersion = pgTable(
  'document_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id').notNull().references(() => document.id),
    contentHash: text('content_hash').notNull(),
    manifestKey: text('manifest_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('document_version_hash_uq').on(t.documentId, t.contentHash)],
)

export const documentFile = pgTable(
  'document_file',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentVersionId: uuid('document_version_id').notNull().references(() => documentVersion.id),
    role: text('role').notNull(),
    label: text('label').notNull(),
    url: text('url'),
    mime: text('mime').notNull(),
    encoding: text('encoding'),
    bytes: integer('bytes').notNull(),
    sha256: text('sha256').notNull(),
    objectKey: text('object_key').notNull(),
    pageRange: jsonb('page_range').$type<[number, number] | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('document_file_uq').on(t.documentVersionId, t.role, t.label)],
)

export const documentProfile = pgTable(
  'document_profile',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentVersionId: uuid('document_version_id').notNull().references(() => documentVersion.id),
    version: integer('version').notNull(),
    decision: text('decision').notNull(),
    docType: text('doc_type'),
    officialNumber: text('official_number'),
    institution: text('institution'),
    publicationDate: date('publication_date'),
    changeKind: text('change_kind'),
    gtipCodes: text('gtip_codes').array().notNull().default([]),
    sectors: text('sectors').array().notNull().default([]),
    keywords: text('keywords').array().notNull().default([]),
    confidence: real('confidence'),
    needsPrior: text('needs_prior'),
    objectKey: text('object_key').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('document_profile_version_uq').on(t.documentVersionId, t.version), index('document_profile_decision_idx').on(t.decision)],
)
