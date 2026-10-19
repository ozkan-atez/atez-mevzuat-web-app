import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib'
import type { Logger } from '../log'
import { silentLogger } from '../log'
import type { AmqpHandle } from './amqp'

/** Bağlantı kurulduktan sonra çalışan kurulum (ör. tüketiciler); dönen fonksiyon aboneliği bırakır. */
export type AmqpSetup = (connection: ChannelModel) => Promise<() => Promise<void>>

export interface ResilientAmqpOptions {
  logger?: Logger
  /** Her (yeniden) bağlantıda bir kez: ör. topoloji doğrulama. */
  onConnect?: (connection: ChannelModel) => Promise<void>
  minDelayMs?: number
  maxDelayMs?: number
}

/**
 * Kendiliğinden yeniden bağlanan RabbitMQ bağlantısı (§12).
 *
 * amqplib bağlantı/kanal hatalarını `'error'` olayı olarak yayar; dinleyici yoksa süreç çöker
 * (canlıda: uyku sonrası heartbeat timeout, 2026-10-18). Burada hatalar loglanır, bağlantı
 * kapanınca kademeli beklemeyle (1 sn → 30 sn, jitter) yeniden bağlanılır; topoloji yeniden
 * doğrulanır, publisher confirm kanalı ve `subscribe` ile kaydedilen tüketiciler yeniden kurulur.
 * Kesinti boyunca `publisher`/`connection` erişimi hata fırlatır; outbox relay bunu bir sonraki
 * turda yeniden dener, mesajlar outbox'ta bekler (en-az-bir-kez teslim korunur).
 */
export class ResilientAmqp implements AmqpHandle {
  private current: { connection: ChannelModel; publisher: ConfirmChannel } | null = null
  private readonly setups = new Map<number, { setup: AmqpSetup; stop: (() => Promise<void>) | null }>()
  private nextId = 0
  private closing = false
  private reconnecting: Promise<void> | null = null
  private attempt = 0
  private readonly log: Logger
  /** Toplam yeniden bağlantı sayısı (gözlem ve testler için). */
  reconnects = 0

  constructor(
    private readonly url: string,
    private readonly opts: ResilientAmqpOptions = {},
  ) {
    this.log = opts.logger ?? silentLogger
  }

  /** İlk bağlantı: başarılı olana kadar kademeli bekleyerek dener. */
  async start(): Promise<this> {
    await this.connectLoop()
    return this
  }

  get connection(): ChannelModel {
    if (!this.current) throw new Error('RabbitMQ bağlantısı yok (yeniden bağlanılıyor)')
    return this.current.connection
  }

  get publisher(): ConfirmChannel {
    if (!this.current) throw new Error('RabbitMQ bağlantısı yok (yeniden bağlanılıyor)')
    return this.current.publisher
  }

  get connected(): boolean {
    return this.current !== null
  }

  /** Kurulumu şimdi ve her yeniden bağlantıdan sonra çalıştırır. */
  async subscribe(setup: AmqpSetup): Promise<() => Promise<void>> {
    const id = this.nextId++
    const entry = { setup, stop: null as (() => Promise<void>) | null }
    this.setups.set(id, entry)
    if (this.current) entry.stop = await setup(this.current.connection)
    return async () => {
      this.setups.delete(id)
      await entry.stop?.().catch(() => {})
    }
  }

  async close(): Promise<void> {
    this.closing = true
    for (const entry of this.setups.values()) await entry.stop?.().catch(() => {})
    this.setups.clear()
    const cur = this.current
    this.current = null
    if (cur) {
      await cur.publisher.close().catch(() => {})
      await cur.connection.close().catch(() => {})
    }
  }

  private delay(): number {
    const min = this.opts.minDelayMs ?? 1000
    const max = this.opts.maxDelayMs ?? 30_000
    const base = Math.min(max, min * 2 ** Math.min(this.attempt, 16))
    return Math.round(base / 2 + Math.random() * (base / 2))
  }

  private async connectLoop(): Promise<void> {
    while (!this.closing) {
      try {
        await this.connectOnce()
        this.attempt = 0
        return
      } catch (err) {
        const wait = this.delay()
        this.attempt++
        this.log.warn('rabbitmq connect failed; retrying', { attempt: this.attempt, waitMs: wait, error: String(err) })
        await new Promise((r) => setTimeout(r, wait))
      }
    }
  }

  private async connectOnce(): Promise<void> {
    const connection = await amqp.connect(this.url)
    connection.on('error', (err) => this.log.warn('rabbitmq connection error', { error: String(err) }))
    connection.on('close', () => this.onConnectionClosed(connection))
    try {
      await this.opts.onConnect?.(connection)
      const publisher = await this.openPublisher(connection)
      this.current = { connection, publisher }
      for (const entry of this.setups.values()) entry.stop = await entry.setup(connection)
    } catch (err) {
      this.current = null
      await connection.close().catch(() => {})
      throw err
    }
    this.log.info('rabbitmq connected', { reconnects: this.reconnects })
  }

  private async openPublisher(connection: ChannelModel): Promise<ConfirmChannel> {
    const publisher = await connection.createConfirmChannel()
    publisher.on('error', (err) => this.log.warn('rabbitmq publisher channel error', { error: String(err) }))
    // Kanal tek başına kapanırsa (ör. olmayan exchange'e yayın) bağlantı açık kalır: kanalı yenile.
    publisher.on('close', () => {
      if (this.closing || this.current?.publisher !== publisher) return
      void this.openPublisher(connection)
        .then((next) => {
          if (this.current?.connection === connection) this.current = { connection, publisher: next }
        })
        .catch((err) => this.log.warn('rabbitmq publisher reopen failed', { error: String(err) }))
    })
    return publisher
  }

  private onConnectionClosed(connection: ChannelModel): void {
    if (this.closing || this.current?.connection !== connection) return
    this.current = null
    for (const entry of this.setups.values()) entry.stop = null // kanallar bağlantıyla birlikte kapandı
    if (this.reconnecting) return
    this.log.warn('rabbitmq connection closed; reconnecting')
    this.reconnecting = this.connectLoop().then(() => {
      this.reconnects++
      this.reconnecting = null
    })
  }
}
