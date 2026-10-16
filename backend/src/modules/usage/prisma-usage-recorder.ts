import type { PrismaClient } from '@prisma/client'
import { getActorContext } from '../../platform/actor-context'
import type { UsageCall, UsageRecorder } from './measurement'

export class PrismaUsageRecorder implements UsageRecorder {
  constructor(private readonly prisma: PrismaClient) {}
  async save(call: UsageCall) {
    const actor = getActorContext()
    const data = {...call, workspaceId: actor?.workspaceId ?? null, actorUserId: actor?.serviceActor ? null : actor?.userId ?? null}
    await this.prisma.chatUsageEvent.upsert({where: {id: call.id}, create: data, update: {
      inputTokens: call.inputTokens, outputTokens: call.outputTokens, totalTokens: call.totalTokens,
      cachedTokens: call.cachedTokens, reasoningTokens: call.reasoningTokens,
      status: call.status, completedAt: call.completedAt,
    }})
  }
}
