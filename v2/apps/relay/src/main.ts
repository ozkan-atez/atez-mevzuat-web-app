import { OutboxRelay, bootRuntime } from '@atez/platform'

/** Outbox → RabbitMQ relay süreci (§12). */
const rt = await bootRuntime('relay')
const relay = new OutboxRelay(rt.db.db, rt.amqp.publisher, { logger: rt.log })
relay.start()
rt.log.info('relay started')

const shutdown = async () => {
  await relay.stop()
  await rt.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
