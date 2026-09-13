import type { PgBoss } from 'pg-boss'
import type { ScanQueue } from '../application/ports'
import { manualScanQueueName } from '../../../platform/queue'

export class PgBossScanQueue implements ScanQueue {
  constructor(private readonly queue: PgBoss) {}

  async enqueue(runId: string): Promise<string> {
    const id = await this.queue.send(manualScanQueueName, { runId }, { singletonKey: runId })
    if (!id) throw new Error(`Queue rejected scan run ${runId}`)
    return id
  }
}
