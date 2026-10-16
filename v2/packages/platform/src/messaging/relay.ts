import { sql } from 'drizzle-orm'
import type { ConfirmChannel } from 'amqplib'
import type { Db } from '../db/client'
import type { Logger } from '../log'
import { silentLogger } from '../log'
import { publishConfirmed } from './amqp'

interface OutboxRow {
  id: number
  exchange: string
  routing_key: string
  envelope: unknown
  headers: Record<string, unknown> | null
}

/**
 * Outbox → RabbitMQ (§12 `relay` süreci). `FOR UPDATE SKIP LOCKED` ile birden çok relay
 * güvenle çalışır; her mesaj publisher confirm alındıktan sonra yayınlandı işaretlenir.
 * Teslim en-az-bir-kez; tüketiciler inbox + lease ile idempotenttir.
 */
export class OutboxRelay {
  private stopped = false
  private loop: Promise<void> | null = null

  constructor(
    private readonly db: Db,
    private readonly channel: ConfirmChannel,
    private readonly opts: { batchSize?: number; idleMs?: number; logger?: Logger } = {},
  ) {}

  /** Bir parti yayınlar; yayınlanan mesaj sayısını döner. */
  async publishBatch(): Promise<number> {
    const batch = this.opts.batchSize ?? 100
    return this.db.transaction(async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, exchange, routing_key, envelope, headers FROM outbox
        WHERE published_at IS NULL ORDER BY id LIMIT ${batch} FOR UPDATE SKIP LOCKED`)
      const rows = res.rows as unknown as OutboxRow[]
      if (rows.length === 0) return 0
      const published: number[] = []
      for (const row of rows) {
        try {
          await publishConfirmed(this.channel, row.exchange, row.routing_key, row.envelope, row.headers ?? {})
          published.push(row.id)
        } catch (err) {
          ;(this.opts.logger ?? silentLogger).warn('outbox publish failed', { id: row.id, error: String(err) })
          await tx.execute(sql`UPDATE outbox SET publish_attempts = publish_attempts + 1, last_error = ${String(err)} WHERE id = ${row.id}`)
          break // sırayı korumak için partiyi burada kes
        }
      }
      if (published.length) {
        await tx.execute(sql`UPDATE outbox SET published_at = now(), publish_attempts = publish_attempts + 1
          WHERE id IN (${sql.join(published.map((id) => sql`${id}`), sql`, `)})`)
      }
      return published.length
    })
  }

  start(): void {
    if (this.loop) return
    const idle = this.opts.idleMs ?? 200
    this.loop = (async () => {
      while (!this.stopped) {
        let n = 0
        try {
          n = await this.publishBatch()
        } catch (err) {
          ;(this.opts.logger ?? silentLogger).error('relay batch failed', { error: String(err) })
        }
        if (n === 0) await new Promise((r) => setTimeout(r, idle))
      }
    })()
  }

  async stop(): Promise<void> {
    this.stopped = true
    await this.loop
    this.loop = null
  }
}
