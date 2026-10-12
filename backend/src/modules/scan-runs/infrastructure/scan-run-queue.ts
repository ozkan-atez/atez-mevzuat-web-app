import type { RabbitQueue } from '../../../platform/rabbitmq'
import type { ScanCommand, ScanQueue } from '../application/ports'
import { manualScanQueueName } from '../../../platform/queue'

export class RabbitScanQueue implements ScanQueue {
  constructor(private readonly queue: RabbitQueue) {}

  async enqueue(command: ScanCommand): Promise<string> {
    const id = await this.queue.send(manualScanQueueName, command, { singletonKey: command.outboxId })
    if (!id) throw new Error(`Queue rejected scan command ${command.outboxId}`)
    return id
  }
}
