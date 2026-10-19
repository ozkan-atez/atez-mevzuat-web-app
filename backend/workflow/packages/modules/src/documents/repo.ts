import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import type { FileRef, FileRole } from '@atez/contracts'
import { schema, type DbOrTx } from '@atez/platform'

const { document, documentVersion, documentFile, documentProfile, sourceObservation } = schema

/** İşlemi tamamlanmış belge durumları; ön kontrolde (basamak 1) SEEN sayılır. */
export const FINAL_STATES = ['TITLE_OUT', 'PROFILED'] as const

export interface DiscoveredRow {
  canonicalKey: string
  url: string
  title: string
  kind: string
  publishedOn: string | null
  listContext: Record<string, unknown>
}

export async function upsertDiscovered(db: DbOrTx, sourceId: string, rows: DiscoveredRow[]) {
  if (rows.length === 0) return []
  return db
    .insert(document)
    .values(rows.map((r) => ({ sourceId, ...r, processingState: 'DISCOVERED' })))
    .onConflictDoUpdate({
      target: [document.sourceId, document.canonicalKey],
      set: { lastSeenAt: sql`now()`, title: sql`excluded.title`, listContext: sql`excluded.list_context` },
    })
    .returning({ id: document.id, canonicalKey: document.canonicalKey, processingState: document.processingState, firstSeenAt: document.firstSeenAt, lastSeenAt: document.lastSeenAt })
}

export async function documentsForDate(db: DbOrTx, sourceId: string, date: string, opts: { onlyPending?: boolean } = {}) {
  return db
    .select()
    .from(document)
    .where(
      and(
        eq(document.sourceId, sourceId),
        eq(document.publishedOn, date),
        opts.onlyPending ? notInArray(document.processingState, [...FINAL_STATES]) : undefined,
      ),
    )
}

export async function getDocument(db: DbOrTx, id: string) {
  const [d] = await db.select().from(document).where(eq(document.id, id))
  return d ?? null
}

export async function getDocuments(db: DbOrTx, ids: string[]) {
  if (ids.length === 0) return []
  return db.select().from(document).where(inArray(document.id, ids))
}

export async function setTitleDecision(db: DbOrTx, id: string, decision: string, reason: string, decidedBy: string) {
  await db
    .update(document)
    .set({
      titleDecision: decision,
      titleReason: reason,
      titleDecidedBy: decidedBy,
      processingState: sql`CASE WHEN ${decision} = 'OUT' THEN 'TITLE_OUT' WHEN ${document.processingState} = 'TITLE_OUT' THEN 'DISCOVERED' ELSE ${document.processingState} END`,
    })
    .where(eq(document.id, id))
}

export async function setDocumentState(db: DbOrTx, id: string, state: 'FETCHED' | 'PROFILED', extra: { latestVersionId?: string; etag?: string | null; lastModified?: string | null } = {}) {
  await db
    .update(document)
    .set({ processingState: state, ...extra })
    .where(eq(document.id, id))
}

export async function updateValidators(db: DbOrTx, id: string, etag: string | null, lastModified: string | null) {
  await db.update(document).set({ etag, lastModified }).where(eq(document.id, id))
}

export async function findVersion(db: DbOrTx, documentId: string, contentHash: string) {
  const [v] = await db
    .select()
    .from(documentVersion)
    .where(and(eq(documentVersion.documentId, documentId), eq(documentVersion.contentHash, contentHash)))
  return v ?? null
}

export async function getVersion(db: DbOrTx, id: string) {
  const [v] = await db.select().from(documentVersion).where(eq(documentVersion.id, id))
  return v ?? null
}

export async function createVersion(db: DbOrTx, documentId: string, contentHash: string, manifestKey: string | null) {
  const [v] = await db
    .insert(documentVersion)
    .values({ documentId, contentHash, manifestKey })
    .onConflictDoUpdate({ target: [documentVersion.documentId, documentVersion.contentHash], set: { manifestKey: sql`coalesce(excluded.manifest_key, document_version.manifest_key)` } })
    .returning()
  return v!
}

export async function versionCount(db: DbOrTx, documentId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(documentVersion).where(eq(documentVersion.documentId, documentId))
  return r!.n
}

export type NewFileInput = NewFile

export interface NewFile {
  role: FileRole
  label: string
  url: string | null
  mime: string
  encoding: string | null
  bytes: number
  sha256: string
  objectKey: string
  pageRange: [number, number] | null
}

/** Dosyaları kaydeder (aynı sürüm + rol + etiket ikinci kez yazılmaz) ve FileRef döner. */
export async function upsertFiles(db: DbOrTx, documentVersionId: string, files: NewFile[]): Promise<FileRef[]> {
  if (files.length === 0) return []
  await db
    .insert(documentFile)
    .values(files.map((f) => ({ documentVersionId, ...f })))
    .onConflictDoNothing()
  const rows = await db
    .select()
    .from(documentFile)
    .where(and(eq(documentFile.documentVersionId, documentVersionId), inArray(documentFile.role, [...new Set(files.map((f) => f.role))])))
  const byKey = new Map(rows.map((r) => [`${r.role}:${r.label}`, r]))
  return files.map((f) => {
    const r = byKey.get(`${f.role}:${f.label}`)!
    return { fileId: r.id, role: r.role as FileRole, label: r.label, mime: r.mime, bytes: r.bytes, sha256: r.sha256, objectKey: r.objectKey, pageRange: r.pageRange ?? null }
  })
}

export async function filesOf(db: DbOrTx, documentVersionId: string, roles: FileRole[]): Promise<FileRef[]> {
  const rows = await db
    .select()
    .from(documentFile)
    .where(and(eq(documentFile.documentVersionId, documentVersionId), inArray(documentFile.role, roles)))
    .orderBy(documentFile.createdAt, documentFile.label)
  return rows.map((r) => ({ fileId: r.id, role: r.role as FileRole, label: r.label, mime: r.mime, bytes: r.bytes, sha256: r.sha256, objectKey: r.objectKey, pageRange: r.pageRange ?? null }))
}

export async function nextProfileVersion(db: DbOrTx, documentVersionId: string): Promise<number> {
  const [r] = await db
    .select({ v: sql<number>`coalesce(max(${documentProfile.version}), 0)::int` })
    .from(documentProfile)
    .where(eq(documentProfile.documentVersionId, documentVersionId))
  return r!.v + 1
}

export async function insertProfile(db: DbOrTx, row: typeof documentProfile.$inferInsert) {
  const [r] = await db.insert(documentProfile).values(row).returning({ id: documentProfile.id })
  return r!.id
}

export async function latestProfile(db: DbOrTx, documentVersionId: string) {
  const [r] = await db.select().from(documentProfile).where(eq(documentProfile.documentVersionId, documentVersionId)).orderBy(desc(documentProfile.version)).limit(1)
  return r ?? null
}

// ---- Kaynak gözlemi (ön kontrol basamak 0) -------------------------------------

export async function getObservation(db: DbOrTx, sourceId: string, scopeKey: string) {
  const [r] = await db
    .select()
    .from(sourceObservation)
    .where(and(eq(sourceObservation.sourceId, sourceId), eq(sourceObservation.scopeKey, scopeKey)))
  return r ?? null
}

export async function saveObservation(db: DbOrTx, sourceId: string, scopeKey: string, observed: Record<string, unknown>, observedHash: string) {
  await db
    .insert(sourceObservation)
    .values({ sourceId, scopeKey, observed, observedHash })
    .onConflictDoUpdate({ target: [sourceObservation.sourceId, sourceObservation.scopeKey], set: { observed, observedHash, checkedAt: sql`now()` } })
}
