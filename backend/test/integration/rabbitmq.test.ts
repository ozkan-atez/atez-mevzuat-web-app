import amqp from 'amqplib'
import { topicAnalysisQueueName } from '../../src/platform/queue'
import { RabbitQueue } from '../../src/platform/rabbitmq'
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { rabbitQueue, refreshQueueName } from '../../src/platform/rabbitmq'
import { prisma } from '../../src/platform/database'

const enabled = Boolean(process.env.RABBITMQ_TEST_URL)
if (enabled) process.env.RABBITMQ_URL = process.env.RABBITMQ_TEST_URL!
// Run only against an isolated RabbitMQ vhost and test database.
describe.skipIf(!enabled)('RabbitMQ durable background jobs', () => {
  afterAll(async () => { await rabbitQueue.close(); await prisma.$disconnect() })
  it('deduplicates concurrent publications, records failures and queues bounded retries', async () => {
    const attempts = new Map<string, number>()
    const handled: string[] = []
    const resumed: number[] = []
    await rabbitQueue.work(refreshQueueName, async jobs => {
      for (const job of jobs) {
        attempts.set(job.id, (attempts.get(job.id) ?? 0) + 1)
        if (job.data.fail || (job.data.transient && attempts.get(job.id) === 1)) throw new Error('test failure')
        handled.push(job.id)
        if (job.data.recovered) resumed.push(job.retryCount)
      }
    })
    const id = randomUUID()
    await Promise.all([rabbitQueue.send(refreshQueueName, {}, { singletonKey: id }), rabbitQueue.send(refreshQueueName, {}, { singletonKey: id })])
    await expect.poll(async () => (await prisma.backgroundJob.findUnique({ where: { id } }))?.status).toBe('COMPLETED')
    expect(handled.filter(item => item === id)).toHaveLength(1)
    const staleId = randomUUID()
    await prisma.backgroundJob.create({ data: { id: staleId, queue: refreshQueueName, leaseUntil: new Date(0), attempts: 1 } })
    await rabbitQueue.send(refreshQueueName, { recovered: true }, { singletonKey: staleId })
    await expect.poll(async () => (await prisma.backgroundJob.findUnique({ where: { id: staleId } }))?.status).toBe('COMPLETED')
    expect(resumed).toEqual([1])
    const failedId = randomUUID()
    await rabbitQueue.publish(refreshQueueName, { id: failedId, data: { fail: true }, retryCount: 2 })
    await expect.poll(async () => (await prisma.backgroundJob.findUnique({ where: { id: failedId } }))?.status).toBe('FAILED')
    const retryId = await rabbitQueue.send(refreshQueueName, { fail: true })
    await expect.poll(async () => (await prisma.backgroundJob.findUnique({ where: { id: retryId } }))?.status).toBe('RETRY')
    const status = (await rabbitQueue.status()).find(queue => queue.name === refreshQueueName)!
    expect(status.consumers).toBe(1); expect(status.failed).toBeGreaterThan(0); expect(status.retrying).toBeGreaterThan(0)
    const transientId = await rabbitQueue.send(refreshQueueName, { transient: true })
    await expect.poll(async () => (await prisma.backgroundJob.findUnique({ where: { id: transientId } }))?.status, { timeout: 45000 }).toBe('COMPLETED')
    expect(attempts.get(transientId)).toBe(2)
    await expect.poll(async () => (await prisma.backgroundJob.findUnique({ where: { id: retryId } }))?.status, { timeout: 45000 }).toBe('FAILED')
    expect(attempts.get(retryId)).toBe(3)
  }, 90000)
  it('rejects a confirmed publication when the destination queue is missing', async () => {
    const connection = await amqp.connect(process.env.RABBITMQ_TEST_URL!)
    const channel = await connection.createChannel()
    try {
      await channel.deleteQueue(topicAnalysisQueueName)
      await expect(rabbitQueue.send(topicAnalysisQueueName, {})).rejects.toThrow('yönlendiremedi')
    } finally {
      await channel.assertQueue(topicAnalysisQueueName, { durable: true })
      await connection.close()
    }
  })
  it('waits for the active delivery to complete before shutting down', async () => {
    const broker = new RabbitQueue()
    let release!: () => void
    let started!: () => void
    const start = new Promise<void>(resolve => { started = resolve })
    const finish = new Promise<void>(resolve => { release = resolve })
    await broker.work(topicAnalysisQueueName, async () => { started(); await finish })
    const id = await broker.send(topicAnalysisQueueName, {})
    await start
    const stopping = broker.close()
    expect((await prisma.backgroundJob.findUniqueOrThrow({ where: { id } })).status).toBe('RUNNING')
    release(); await stopping
    expect((await prisma.backgroundJob.findUniqueOrThrow({ where: { id } })).status).toBe('COMPLETED')
  })

})
