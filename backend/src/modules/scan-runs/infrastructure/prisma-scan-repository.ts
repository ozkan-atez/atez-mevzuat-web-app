import type { PrismaClient } from '@prisma/client'
import type { ScanRunStatus } from '../domain/scan-run'

export class PrismaScanRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createManualRun(input: { requestKey: string; targetDate: string }): Promise<{
    id: string
    status: ScanRunStatus
    targetDate: string
  }> {
    const run = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.scanRun.findUnique({ where: { requestKey: input.requestKey } })
      if (existing) return existing

      return tx.scanRun.create({
        data: {
          requestKey: input.requestKey,
          targetDate: new Date(`${input.targetDate}T00:00:00.000Z`),
          timezone: 'Europe/Istanbul',
          outbox: { create: {} },
        },
      })
    })

    return {
      id: run.id,
      status: run.status,
      targetDate: run.targetDate.toISOString().slice(0, 10),
    }
  }

  async claimPendingOutbox(limit: number): Promise<Array<{ id: string; scanRunId: string; attempts: number }>> {
    return this.prisma.scanOutbox.findMany({
      where: { dispatchedAt: null, availableAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, scanRunId: true, attempts: true },
    })
  }

  async markOutboxDispatched(outboxId: string, queueJobId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.scanOutbox.update({
        where: { id: outboxId },
        data: { dispatchedAt: new Date(), lastError: null },
      }),
      this.prisma.scanRun.update({
        where: { id: (await this.prisma.scanOutbox.findUniqueOrThrow({ where: { id: outboxId } })).scanRunId },
        data: { queueJobId },
      }),
    ])
  }

  async deferOutbox(outboxId: string, error: string, availableAt: Date): Promise<void> {
    await this.prisma.scanOutbox.update({
      where: { id: outboxId },
      data: { attempts: { increment: 1 }, lastError: error, availableAt },
    })
  }
}
