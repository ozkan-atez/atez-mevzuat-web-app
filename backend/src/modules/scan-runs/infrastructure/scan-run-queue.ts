import type { PgBoss } from 'pg-boss'
import type { ScanCommand, ScanQueue } from '../application/ports'
import { manualScanQueueName } from '../../../platform/queue'

export class PgBossScanQueue implements ScanQueue {
  constructor(private readonly queue: PgBoss) {}

  async enqueue(command: ScanCommand): Promise<string> {
    const id = await this.queue.send(manualScanQueueName, command, { singletonKey: command.outboxId })
    if (!id) throw new Error(`Queue rejected scan command ${command.outboxId}`)
    return id
  }
}
