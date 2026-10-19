export type { ChannelModel } from 'amqplib'
import amqp, { type Channel, type ChannelModel, type ConfirmChannel, type ConsumeMessage } from 'amqplib'
import { Envelope } from '@atez/contracts'
import type { Logger } from '../log'
import { silentLogger } from '../log'
import { isConnectionError } from '../errors'

export interface AmqpHandle {
  readonly connection: ChannelModel
  /** Publisher confirms ile yayın kanalı. */
  readonly publisher: ConfirmChannel
  close(): Promise<void>
}

export async function connectAmqp(url: string): Promise<AmqpHandle> {
  const connection = await amqp.connect(url)
  const publisher = await connection.createConfirmChannel()
  return {
    connection,
    publisher,
    async close() {
      await publisher.close().catch(() => {})
      await connection.close().catch(() => {})
    },
  }
}

export function publishConfirmed(
  channel: ConfirmChannel,
  exchange: string,
  routingKey: string,
  envelope: unknown,
  headers: Record<string, unknown> = {},
): Promise<void> {
  const body = Buffer.from(JSON.stringify(envelope))
  const messageId = (envelope as { messageId?: string }).messageId
  return new Promise((resolve, reject) => {
    channel.publish(
      exchange,
      routingKey,
      body,
      { persistent: true, contentType: 'application/json', messageId, headers },
      (err) => (err ? reject(err) : resolve()),
    )
  })
}

export type ConsumeResult = 'ack' | 'park'

/**
 * Manuel ack, `prefetch(1)` (Ek B.2). Zarf doğrulanamazsa mesaj park edilir (nack, requeue=false →
 * DLX → q.parking). İşleyici hata fırlatırsa da park edilir: geçici hatalar işleyicinin
 * içinde outbox ile retry'a yönlendirilir, burada yeniden kuyruğa konmaz.
 */
export async function consume(
  connection: ChannelModel,
  queue: string,
  handler: (envelope: Envelope, raw: ConsumeMessage) => Promise<ConsumeResult>,
  opts: { prefetch?: number; logger?: Logger; requeueDelayMs?: number } = {},
): Promise<{ channel: Channel; cancel(): Promise<void> }> {
  const log = opts.logger ?? silentLogger
  const channel = await connection.createChannel()
  // Kanal hatası (ör. bağlantı koparken ack) dinleyicisiz kalırsa süreç çöker; yeniden kurulum ResilientAmqp'tedir.
  channel.on('error', (err) => log.warn('consumer channel error', { queue, error: String(err) }))
  await channel.prefetch(opts.prefetch ?? 1)
  const { consumerTag } = await channel.consume(queue, async (msg) => {
    if (!msg) return
    let parsed: Envelope
    try {
      parsed = Envelope.parse(JSON.parse(msg.content.toString('utf8')))
    } catch (err) {
      log.error('invalid envelope → parking', { queue, error: String(err) })
      channel.nack(msg, false, false)
      return
    }
    try {
      const result = await handler(parsed, msg)
      if (result === 'ack') channel.ack(msg)
      else channel.nack(msg, false, false)
    } catch (err) {
      if (isConnectionError(err)) {
        // Postgres/ağ kesintisi işin hatası değildir: park etme, kısa bekleyip kuyruğa geri ver.
        log.warn('consumer infra error → requeue', { queue, messageId: parsed.messageId, error: String(err) })
        await new Promise((r) => setTimeout(r, opts.requeueDelayMs ?? 1000))
        try {
          channel.nack(msg, false, true)
        } catch {
          /* kanal kapandıysa mesaj zaten yeniden teslim edilir */
        }
        return
      }
      log.error('consumer handler crashed → parking', { queue, messageId: parsed.messageId, error: String(err) })
      try {
        channel.nack(msg, false, false)
      } catch {
        /* kanal kapanmış olabilir; mesaj yeniden teslim edilir ve lease bastırır */
      }
    }
  })
  return {
    channel,
    async cancel() {
      await channel.cancel(consumerTag).catch(() => {})
      await channel.close().catch(() => {})
    },
  }
}
