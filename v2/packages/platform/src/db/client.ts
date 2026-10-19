import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema/index'
import { silentLogger, type Logger } from '../log'

export type Db = NodePgDatabase<typeof schema>
export type PoolClient = pg.PoolClient
/** Transaction veya kök bağlantı — ikisi de aynı sorgu yüzeyine sahip. */
export type DbOrTx = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

export interface DbHandle {
  db: Db
  pool: pg.Pool
  close(): Promise<void>
}

export function createDb(url: string, opts: { max?: number; logger?: Logger } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 10 })
  // Boştaki bir istemci düşerse (Postgres yeniden başlatma, 57P01, ağ) pg havuzu 'error' yayar; dinleyici
  // yoksa süreç çöker. Hata loglanır, düşen istemci havuzdan çıkar ve sonraki sorgu yeni bağlantı açar.
  pool.on('error', (err) => (opts.logger ?? silentLogger).warn('postgres idle client error', { error: String(err), code: (err as { code?: string }).code }))
  const db = drizzle(pool, { schema })
  return { db, pool, close: () => pool.end() }
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''))
}

/**
 * Ek B.3 madde 12: DB testleri yalnızca adı `_test` ile biten bir veritabanında çalışır.
 * Aksi halde test süreci başlamaz.
 */
export function assertTestDatabaseUrl(url: string | undefined): string {
  if (!url) throw new Error('TEST_DATABASE_URL tanımlı değil; DB testleri çalıştırılmadı.')
  const name = databaseName(url)
  if (!name.endsWith('_test')) {
    throw new Error(`Güvenlik: DB testleri yalnızca adı "_test" ile biten veritabanında çalışır (verilen: "${name}").`)
  }
  return url
}
