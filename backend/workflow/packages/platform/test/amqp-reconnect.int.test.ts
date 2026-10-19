import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ConsumeMessage } from 'amqplib'
import { SYSTEM_ACTOR } from '@atez/contracts'
import { OutboxRelay, ResilientAmqp, enqueue, makeEnvelope, publishConfirmed, type DbHandle } from '../src/index'
import { ensureVhost, openTestDb, truncateAll } from '../src/testing/index'

const AMQP_URL = process.env.TEST_AMQP_URL!
const MGMT = new URL(process.env.RABBITMQ_MANAGEMENT_URL!)
const VHOST = decodeURIComponent(new URL(AMQP_URL).pathname.slice(1))
const QUEUE = 'reconnect-test'
const auth = 'Basic ' + Buffer.from(`${decodeURIComponent(MGMT.username)}:${decodeURIComponent(MGMT.password)}`).toString('base64')
const api = `${MGMT.protocol}//${MGMT.host}/api`

/** Sunucu tarafında bağlantıyı koparır (CONNECTION_FORCED): uyku/ağ kesintisi ya da broker yeniden başlatması gibi. */
async function killConnections(): Promise<number> {
  // Yönetim API'si yeni bağlantıları birkaç saniye gecikmeyle listeler.
  let conns: { name: string }[] = []
  for (let i = 0; i < 100 && !conns.length; i++) {
    const res = await fetch(`${api}/vhosts/${encodeURIComponent(VHOST)}/connections`, { headers: { authorization: auth } })
    conns = (await res.json()) as { name: string }[]
    if (!conns.length) await new Promise((r) => setTimeout(r, 200))
  }
  for (const c of conns) await fetch(`${api}/connections/${encodeURIComponent(c.name)}`, { method: 'DELETE', headers: { authorization: auth } })
  return conns.length
}

async function waitFor(check: () => boolean, ms = 20_000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until) throw new Error('zaman aşımı')
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe('RabbitMQ yeniden bağlanma (§12)', () => {
  let amqp: ResilientAmqp
  let db: DbHandle
  const received: string[] = []

  beforeAll(async () => {
    await ensureVhost(MGMT.href, AMQP_URL)
    db = await openTestDb()
    await truncateAll(db)
    amqp = await new ResilientAmqp(AMQP_URL, {
      minDelayMs: 50,
      maxDelayMs: 500,
      onConnect: async (connection) => {
        const ch = await connection.createChannel()
        await ch.assertQueue(QUEUE, { durable: true })
        await ch.purgeQueue(QUEUE)
        await ch.close()
      },
    }).start()
    await amqp.subscribe(async (connection) => {
      const ch = await connection.createChannel()
      ch.on('error', () => {})
      await ch.consume(QUEUE, (m: ConsumeMessage | null) => {
        if (!m) return
        received.push((JSON.parse(m.content.toString()) as { payload: { label: string } }).payload.label)
        ch.ack(m)
      })
      return async () => {
        await ch.close().catch(() => {})
      }
    })
  })
  afterAll(async () => {
    await amqp?.close()
    await db?.close()
  })

  const envelope = (label: string) => makeEnvelope({ type: 'test.ping', correlationId: label, idempotencyKey: label, actor: SYSTEM_ACTOR, payload: { label } })

  it('bağlantı koparılınca süreç çökmez; tüketici, yayın kanalı ve outbox relay kendiliğinden toparlanır', async () => {
    await publishConfirmed(amqp.publisher, '', QUEUE, envelope('önce'))
    await waitFor(() => received.includes('önce'))

    expect(await killConnections()).toBeGreaterThan(0)
    await waitFor(() => !amqp.connected || amqp.reconnects > 0)
    // Kesinti sırasında yazılan outbox mesajı kaybolmaz; relay bağlantı gelince yayınlar.
    await enqueue(db.db, '', QUEUE, envelope('kesinti sırasında'))
    const relay = new OutboxRelay(db.db, amqp, { idleMs: 25 })
    relay.start()
    await waitFor(() => amqp.connected && amqp.reconnects >= 1)

    await publishConfirmed(amqp.publisher, '', QUEUE, envelope('sonra'))
    await waitFor(() => received.includes('sonra') && received.includes('kesinti sırasında'))

    // İkinci kesinti de aynı şekilde atlatılır.
    await killConnections()
    await waitFor(() => amqp.connected && amqp.reconnects >= 2)
    await enqueue(db.db, '', QUEUE, envelope('ikinci kesintiden sonra'))
    await waitFor(() => received.includes('ikinci kesintiden sonra'))
    await relay.stop()
  }, 60_000)
})
