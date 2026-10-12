import type { SourceProcessingDependencies } from './process-source-documents'
import type { PrismaClient } from '@prisma/client'
import type { RabbitQueue } from '../../platform/rabbitmq'
import { sourceQueueName } from '../../platform/rabbitmq'
import { executeSourceRun } from './source-scan-run'
import { tariffCredentialsFromEnv } from './tariff-auth'

export async function dispatchSourceRuns(prisma: PrismaClient, queue: Pick<RabbitQueue, 'send'>) {
  const queued = await prisma.sourceScanRun.findMany({ where: { scanRunId: null, status: 'QUEUED', queueDispatchedAt: null }, select: { id: true, queueVersion: true }, orderBy: { createdAt: 'asc' }, take: 10 })
  for (const run of queued) {
    await queue.send(sourceQueueName, { runId: run.id, version: run.queueVersion }, { singletonKey: `source:${run.id}:${run.queueVersion}` })
    await prisma.sourceScanRun.updateMany({ where: { id: run.id, queueVersion: run.queueVersion }, data: { queueDispatchedAt: new Date() } })
  }
}
export async function executeSourceCommand(prisma: PrismaClient, command: { runId: string; version: number }, retryCount: number, processing?: SourceProcessingDependencies) {
  const current = await prisma.sourceScanRun.findUnique({ where: { id: command.runId } })
  if (!current || current.queueVersion !== command.version) return
  if (retryCount > 0) await prisma.sourceScanRun.updateMany({ where: { id: command.runId, queueVersion: command.version, status: { in: ['RUNNING', 'FAILED'] } }, data: { status: 'QUEUED' } })
  await executeSourceRun(prisma, command.runId, tariffCredentialsFromEnv(), command.version, processing)
  const result = await prisma.sourceScanRun.findUnique({ where: { id: command.runId } })
  if (result?.queueVersion === command.version && result.status === 'FAILED') throw new Error(result.errorSummary ?? 'Kaynak taranamadı.')
}
