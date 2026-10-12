import type { PrismaClient } from '@prisma/client'
import type { ScanCommand } from './ports'
import { runSelectedSources } from '../../managed-sources/run-selected-sources'

export async function executeScanCommand(
  prisma: PrismaClient,
  command: ScanCommand & { resumeStalled?: boolean },
  retryCount: number,
  executeGazette: (resumeStalled: boolean) => Promise<void>,
  scanSources = runSelectedSources,
) {
  const run = await prisma.scanRun.findUniqueOrThrow({ where: { id: command.runId }, select: { sourceKeys: true, status: true } })
  if (['COMPLETED', 'CANCELLED'].includes(run.status)) return
  const resumeStalled = retryCount > 0 || command.resumeStalled === true
  if (command.type === 'START_SCAN' && (run.status === 'AWAITING_RETRY' || (run.status === 'RUNNING' && !resumeStalled))) return
  try {
    let sourceFailures: string[] = []
    const sourceOnlyFilterRetry = command.type === 'RETRY_AI_FILTER' && !run.sourceKeys.includes('resmi-gazete')
    if (command.type === 'START_SCAN' || sourceOnlyFilterRetry) {
      if (!run.sourceKeys.length) throw new Error('Taranacak etkin kaynak bulunamadı.')
      // Mark source-only runs as running too, so the UI follows their real lifecycle.
      await prisma.scanRun.update({ where: { id: command.runId }, data: { status: 'RUNNING', startedAt: new Date(), completedAt: null, errorSummary: null } })
      const results = await scanSources(prisma, command.runId)
      const failed = results.filter(result => ['FAILED', 'PARTIAL'].includes(result.status))
      sourceFailures = failed.map(result => `${result.sourceName}: ${result.errorSummary}`)
      if (!run.sourceKeys.includes('resmi-gazete')) {
        const status = results.length > 0 && results.every(result => result.status === 'FAILED') ? 'FAILED' : failed.length ? 'PARTIAL' : 'COMPLETED'
        await prisma.scanRun.update({ where: { id: command.runId }, data: { status, completedAt: new Date(), totalItems: results.reduce((sum, result) => sum + result.documentCount, 0), completedItems: results.reduce((sum, result) => sum + result.documentCount, 0), errorSummary: sourceFailures.length ? sourceFailures.join('; ').slice(0, 1000) : null } })
        if (status === 'FAILED') throw new Error(sourceFailures.join('; '))
        return
      }
    }
    if (command.type !== 'START_SCAN') {
      const previous = await prisma.sourceScanRun.findMany({ where: { scanRunId: command.runId, status: { in: ['FAILED', 'PARTIAL'] } }, include: { source: { select: { name: true, key: true } } } })
      sourceFailures = previous.map(result => `${result.source.name ?? result.source.key}: ${result.errorSummary}`)
    }
    // START_SCAN has just claimed RUNNING; execution must take over that claim.
    await executeGazette(resumeStalled || command.type === 'START_SCAN')
    if (sourceFailures.length) await prisma.scanRun.updateMany({ where: { id: command.runId, status: 'COMPLETED' }, data: { status: 'PARTIAL', errorSummary: sourceFailures.join('; ').slice(0, 1000) } })
    const completed = await prisma.scanRun.findUnique({ where: { id: command.runId }, select: { status: true, completedAt: true, errorSummary: true } })
    if (completed?.status === 'FAILED') throw new Error(completed.errorSummary ?? 'Tarama başarısız.')
    if (completed && ['COMPLETED', 'PARTIAL'].includes(completed.status)) await prisma.source.updateMany({ where: { key: 'resmi-gazete' }, data: { lastScanned: completed.completedAt ?? new Date() } })
  } catch (error) {
    await prisma.scanRun.updateMany({ where: { id: command.runId, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'FAILED', completedAt: new Date(), errorSummary: (error instanceof Error ? error.message : 'Tarama başarısız.').slice(0, 1000) } })
    throw error
  }
}
