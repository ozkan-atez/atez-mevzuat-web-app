import { sql } from 'drizzle-orm'
import { assertTestDatabaseUrl, createDb, databaseName, type DbHandle } from '../db/client'
import { runMigrations } from '../db/migrate'

/**
 * Test DB bağlantısı. Ek B.3 madde 12: ad `_test` ile bitmiyorsa hiçbir sorgu çalıştırılmaz.
 */
export async function openTestDb(): Promise<DbHandle> {
  const url = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL)
  const handle = createDb(url, { max: 10 })
  await runMigrations(handle.db)
  return handle
}

const TABLES = [
  'report_revision',
  'report',
  'analysis',
  'topic_member',
  'topic',
  'gtip_value',
  'resolution_attempt',
  'document_relation',
  'provider_token',
  'tariff_snapshot',
  'ai_call',
  'document_profile',
  'document_file',
  'document_version',
  'document',
  'source_observation',
  'step_result',
  'work_item',
  'run_step',
  'run',
  'inbox',
  'outbox',
]

/** Tabloları boşaltır — yalnızca `_test` veritabanında. */
export async function truncateAll(handle: DbHandle): Promise<void> {
  const { rows } = await handle.pool.query<{ db: string }>('SELECT current_database() AS db')
  const name = rows[0]!.db
  if (!name.endsWith('_test')) throw new Error(`Güvenlik: truncate yalnızca _test DB'de (bağlı: ${name})`)
  await handle.db.execute(sql.raw(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`))
}

export { databaseName }

/** Test vhost'unu yönetim API'siyle oluşturur (yoksa). */
export async function ensureVhost(managementUrl: string, amqpUrl: string): Promise<void> {
  const vhost = decodeURIComponent(new URL(amqpUrl).pathname.slice(1))
  const user = decodeURIComponent(new URL(amqpUrl).username)
  const mgmt = new URL(managementUrl)
  const auth = 'Basic ' + Buffer.from(`${decodeURIComponent(mgmt.username)}:${decodeURIComponent(mgmt.password)}`).toString('base64')
  const base = `${mgmt.protocol}//${mgmt.host}`
  const v = encodeURIComponent(vhost)
  await fetch(`${base}/api/vhosts/${v}`, { method: 'PUT', headers: { authorization: auth } })
  await fetch(`${base}/api/permissions/${v}/${encodeURIComponent(user)}`, {
    method: 'PUT',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify({ configure: '.*', write: '.*', read: '.*' }),
  })
}

/** Test vhost'undaki kuyrukları boşaltır. */
export async function purgeQueues(managementUrl: string, amqpUrl: string): Promise<void> {
  const vhost = decodeURIComponent(new URL(amqpUrl).pathname.slice(1))
  if (!vhost.endsWith('-test')) throw new Error(`Güvenlik: purge yalnızca -test vhost'ta (verilen: ${vhost})`)
  const mgmt = new URL(managementUrl)
  const auth = 'Basic ' + Buffer.from(`${decodeURIComponent(mgmt.username)}:${decodeURIComponent(mgmt.password)}`).toString('base64')
  const base = `${mgmt.protocol}//${mgmt.host}`
  const res = await fetch(`${base}/api/queues/${encodeURIComponent(vhost)}`, { headers: { authorization: auth } })
  const queues = (await res.json()) as { name: string }[]
  for (const q of queues) {
    await fetch(`${base}/api/queues/${encodeURIComponent(vhost)}/${encodeURIComponent(q.name)}/contents`, { method: 'DELETE', headers: { authorization: auth } })
  }
}
