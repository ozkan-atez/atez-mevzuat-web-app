import type { RabbitQueue } from '../../../platform/rabbitmq'
import { topicAnalysisQueueName } from '../../../platform/queue'

export interface TopicAnalysisCommand {
  outboxId: string
  topicId: string
  command: 'RETRY_ANALYSIS' | 'REVISE_ANALYSIS' | 'REVISE_PUBLICATION' | 'REVISE_FIELDS'
  messageId: string | null
}

export class RabbitTopicAnalysisQueue {
  constructor(private readonly queue: RabbitQueue) {}

  async enqueue(command: TopicAnalysisCommand): Promise<string> {
    const id = await this.queue.send(topicAnalysisQueueName, command, { singletonKey: command.outboxId })
    if (!id) throw new Error(`Queue topic komutunu reddetti: ${command.outboxId}`)
    return id
  }
}
