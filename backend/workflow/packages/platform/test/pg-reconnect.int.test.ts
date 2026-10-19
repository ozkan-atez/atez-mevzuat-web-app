import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { SYSTEM_ACTOR } from '@atez/contracts'
import { OutboxRelay, ResilientAmqp, consume, createDb, enqueue, isConnectionError, makeEnvelope, publishConfirmed, type DbHandle, type Logger } from '../src/index'
import { ensureVhost, truncateAll } from '../src/testing/index'

const DB_URL = process.env.TEST_DATABASE_URL!
const AMQP_URL = process.env.TEST_AMQP_URL!
const QUEUE = 'pg-reconnect-test'

/** Postgres yeniden başlatması / yönetici kesmesi: bu veritabanındaki diğer bütün oturumları 57P01 ile sonlandırır. */
async function terminateBackends(): Promise<number> {
  const admin = new pg.Client({ connectionString: DB_URL })
  await admin.connect()
  const { rowCount } = await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()')
  await admin.end()
  return rowCount ?? 0
}

async function waitFor(check: () => boolean, ms = 20_000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until) throw new Error('zaman aşımı')
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe('Postgres bağlantı kopması (§12)', () => {
  const warnings: string[] = []
  const logger: Logger = { debug() {}, info() {}, error() {}, warn: (msg: string) => void warnings.push(msg), child() { return logger } } as unknown as Logger
  let db: DbHandle
  let amqp: ResilientAmqp

  beforeAll(async () => {
    await ensureVhost(process.env.RABBITMQ_MANAGEMENT_URL!, AMQP_URL)
    db = createDb(DB_URL, { logger })
    await truncateAll(db)
    amqp = await new ResilientAmqp(AMQP_URL, {
      minDelayMs: 50,
      onConnect: async (c) => {
        const ch = await c.createChannel()
        await ch.assertQueue(QUEUE, { durable: true })
        await ch.purgeQueue(QUEUE)
        await ch.close()
      },
    }).start()
  })
  afterAll(async () => {
    await amqp?.close()
    await db?.close()
  })

  const envelope = (label: string) => makeEnvelope({ type: 'test.ping', correlationId: label, idempotencyKey: label, actor: SYSTEM_ACTOR, payload: { label } })

  it('boştaki bağlantılar düşünce süreç çökmez; havuz yeni bağlantı açar, relay kaldığı yerden yayınlar', async () => {
    await Promise.all([1, 2, 3].map(() => db.pool.query('SELECT pg_sleep(0.05)'))) // havuzda boşta istemciler kalsın
    const received: string[] = []
    const sub = await amqp.subscribe((c) => consume(c, QUEUE, async (env) => (received.push((env.payload as { label: string }).label), 'ack')).then((s) => () => s.cancel()))
    const relay = new OutboxRelay(db.db, amqp, { idleMs: 25 })
    relay.start()

    expect(await terminateBackends()).toBeGreaterThan(0)
    await waitFor(() => warnings.includes('postgres idle client error'))
    await enqueue(db.db, '', QUEUE, envelope('kesintiden sonra'))
    await waitFor(() => received.includes('kesintiden sonra'))

    // İkinci kesinti: relay döngüsü sorgu ortasında da kopsa devam eder.
    await terminateBackends()
    await enqueue(db.db, '', QUEUE, envelope('ikinci kesintiden sonra'))
    await waitFor(() => received.includes('ikinci kesintiden sonra'))
    await relay.stop()
    await sub()
  }, 60_000)

  it('işleyicide bağlantı hatası mesajı park etmez; bekleyip yeniden kuyruğa verir', async () => {
    expect(isConnectionError(Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' }))).toBe(true)
    expect(isConnectionError(new Error('Adım girdisi geçersiz'))).toBe(false)
    let attempts = 0
    const done: string[] = []
    const sub = await amqp.subscribe((c) =>
      consume(
        c,
        QUEUE,
        async (env) => {
          attempts++
          if (attempts === 1) throw Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' })
          done.push((env.payload as { label: string }).label)
          return 'ack'
        },
        { requeueDelayMs: 50 },
      ).then((s) => () => s.cancel()),
    )
    await publishConfirmed(amqp.publisher, '', QUEUE, envelope('yeniden denenecek'))
    await waitFor(() => done.includes('yeniden denenecek'))
    expect(attempts).toBe(2)
    await sub()
  }, 30_000)
})
