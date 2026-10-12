import amqp, { type ChannelModel, type ConfirmChannel, type Channel } from 'amqplib'
import { randomUUID } from 'node:crypto'
import { prisma } from './database'
import { manualScanQueueName, scheduledScanQueueName, topicAnalysisQueueName } from './queue'

export const operationQueueName = 'atez-operation-task'
export const automationQueueName = 'atez-workspace-daily-automation'
export const sourceQueueName = 'atez-source-scan'
export const sourceSetupQueueName = 'atez-source-setup'
export const refreshQueueName = 'atez-source-refresh'
export const backgroundQueues = [manualScanQueueName, scheduledScanQueueName, topicAnalysisQueueName, automationQueueName, sourceQueueName, refreshQueueName, operationQueueName, sourceSetupQueueName]
export interface BackgroundCommand { id: string; data: any; retryCount: number }
export class RabbitQueue {
  private connection: ChannelModel | undefined
  private publisher: ConfirmChannel | undefined
  private starting: Promise<void> | undefined
  private consuming = false
  private subscriptions: Array<{ channel: Channel; tag: string }> = []
  private inFlight = new Set<Promise<void>>()
  private returns = new Map<string, (error: Error) => void>()
  async start() {
    if (this.publisher) return
    if (this.starting) return this.starting
    this.starting = this.connect().finally(() => { this.starting = undefined })
    return this.starting
  }
  private async connect() {
    const connection = await amqp.connect(process.env.RABBITMQ_URL ?? 'amqp://atez:atezpassword@127.0.0.1:5672', { timeout: 5000 })
    connection.on('error', () => console.error('RabbitMQ connection error'))
    connection.on('close', () => {
      this.publisher = undefined
      this.connection = undefined
      // The supervisor restarts workers, restoring consumers and unacknowledged jobs.
      if (this.consuming) process.exit(1)
    })
    this.connection = connection
    try {
      const channel = await connection.createConfirmChannel()
      channel.on('return', message => this.returns.get(message.properties.correlationId)?.(new Error('RabbitMQ mesajı hedef kuyruğa yönlendiremedi.')))
      channel.on('error', () => console.error('RabbitMQ channel error'))
      channel.on('close', () => { this.publisher = undefined; if (this.consuming) process.exit(1) })
      for (const name of backgroundQueues) {
        await channel.assertQueue(`${name}.failed`, { durable: true })
        await channel.assertQueue(name, { durable: true })
        await channel.assertQueue(`${name}.retry`, { durable: true, arguments: { 'x-message-ttl': 30000, 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': name } })
      }
      this.publisher = channel
    } catch (error) {
      await connection.close().catch(() => undefined)
      throw error
    }
  }
  async send(name: string, data: unknown, options: { singletonKey?: string } = {}) {
    if (!backgroundQueues.includes(name)) throw new Error('Unknown background queue')
    await this.start()
    const id = options.singletonKey ?? randomUUID()
    await this.publish(name, { id, data, retryCount: 0 })
    return id
  }
  async publish(name: string, command: BackgroundCommand) {
    await this.publishBytes(name, Buffer.from(JSON.stringify(command)), command.id)
  }
  private async publishBytes(name: string, content: Buffer, messageId: string = randomUUID()) {
    const channel = this.publisher
    if (!channel) throw new Error('RabbitMQ unavailable')
    const correlationId = randomUUID()
    await new Promise<void>((resolve, reject) => {
      this.returns.set(correlationId, reject)
      try {
        channel.sendToQueue(name, content, { persistent: true, mandatory: true, contentType: 'application/json', messageId, correlationId }, error => error ? reject(error) : resolve())
      } catch (error) { reject(error) }
    }).finally(() => this.returns.delete(correlationId))
  }
  async work(name: string, handler: (jobs: BackgroundCommand[]) => Promise<void>) {
    await this.start()
    this.consuming = true
    const channel = await this.connection!.createChannel()
    channel.on('error', () => console.error('RabbitMQ consumer error'))
    channel.on('close', () => { if (this.consuming) process.exit(1) })
    await channel.prefetch(1)
    const subscription = await channel.consume(name, message => {
      if (!message) return
      const delivery = (async () => {
        let command: BackgroundCommand
        try { command = JSON.parse(message.content.toString()); if (typeof command.id !== 'string' || !command.id || command.id.length > 300 || !Number.isInteger(command.retryCount) || command.retryCount < 0) throw new Error('Invalid command') }
        catch {
          await this.publishBytes(`${name}.failed`, message.content)
          channel.ack(message); return
        }
        // Atomic lease prevents duplicate outbox publications from running concurrently.
        const claimed = await prisma.$queryRaw<Array<{ id: string; attempts: number }>>`
          INSERT INTO "BackgroundJob" ("id", "queue", "status", "leaseUntil", "attempts", "updatedAt")
          VALUES (${command.id}, ${name}, 'RUNNING', NOW() + INTERVAL '90 seconds', 1, NOW())
          ON CONFLICT ("id") DO UPDATE SET "status" = 'RUNNING', "leaseUntil" = NOW() + INTERVAL '90 seconds', "attempts" = "BackgroundJob"."attempts" + 1, "updatedAt" = NOW()
          WHERE "BackgroundJob"."status" NOT IN ('COMPLETED', 'FAILED') AND "BackgroundJob"."leaseUntil" < NOW()
          RETURNING "id", "attempts"`
        if (!claimed.length) {
          const receipt = await prisma.backgroundJob.findUnique({ where: { id: command.id } })
          if (receipt && !['COMPLETED', 'FAILED'].includes(receipt.status)) await this.publish(`${name}.retry`, command)
          channel.ack(message)
          return
        }
        const owner = { id: command.id, status: 'RUNNING', attempts: claimed[0]!.attempts }
        const heartbeat = setInterval(() => void prisma.backgroundJob.updateMany({ where: owner, data: { leaseUntil: new Date(Date.now() + 90000) } }).catch(() => process.exit(1)), 30000)
        try {
          await handler([{ ...command, retryCount: Math.max(command.retryCount, claimed[0]!.attempts - 1) }])
          const completed = await prisma.backgroundJob.updateMany({ where: owner, data: { status: 'COMPLETED', lastError: null } })
          if (!completed.count) throw new Error('İş kilidi başka bir çalışana devredildi.')
          channel.ack(message)
        } catch (error) {
          clearInterval(heartbeat)
          const failed = command.retryCount >= 2 || claimed[0]!.attempts >= 3
          // Keep the lease until the retry/failure message is durably routed. A duplicate
          // publication must not take over in the gap between failure and confirmation.
          await this.publish(`${name}.${failed ? 'failed' : 'retry'}`, { ...command, retryCount: command.retryCount + 1 })
          const released = await prisma.backgroundJob.updateMany({ where: owner, data: { status: failed ? 'FAILED' : 'RETRY', leaseUntil: new Date(0), lastError: (error instanceof Error ? error.message : 'İş başarısız').slice(0, 1000) } })
          if (!released.count) throw new Error('İş kilidi başka bir çalışana devredildi.')
          channel.ack(message)
        } finally { clearInterval(heartbeat) }
      })().catch(error => { console.error('RabbitMQ delivery failed:', error); process.exit(1) })
      this.inFlight.add(delivery)
      void delivery.finally(() => this.inFlight.delete(delivery))
    }, { noAck: false })
    this.subscriptions.push({ channel, tag: subscription.consumerTag })
  }
  async status() {
    await this.start()
    return Promise.all(backgroundQueues.map(async name => {
      const ready = await this.publisher!.checkQueue(name)
      const retry = await this.publisher!.checkQueue(`${name}.retry`)
      const failed = await this.publisher!.checkQueue(`${name}.failed`)
      return { name, waiting: ready.messageCount, consumers: ready.consumerCount, retrying: retry.messageCount, failed: failed.messageCount }
    }))
  }
  async close() {
    this.consuming = false
    for (const { channel, tag } of this.subscriptions) await channel.cancel(tag).catch(() => undefined)
    this.subscriptions = []
    await Promise.all([...this.inFlight])
    await this.connection?.close()
  }
}
export const rabbitQueue = new RabbitQueue()
