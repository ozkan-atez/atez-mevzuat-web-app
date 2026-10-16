import { sourceCaptureFailure } from './source-capture-failures'
import type { SourceProcessingDependencies } from './process-source-documents'
import type { PrismaClient } from '@prisma/client'
import { createSourceRun, executeSourceRun } from './source-scan-run'
import { tariffCredentialsFromEnv } from './tariff-auth'

export interface SelectedSourceResult { sourceKey: string; sourceName: string; status: string; errorSummary: string | null; documentCount: number }

export async function runSelectedSources(prisma: PrismaClient, scanRunId: string, processing?: SourceProcessingDependencies): Promise<SelectedSourceResult[]> {
  const parent = await prisma.scanRun.findUniqueOrThrow({ where: { id: scanRunId }, select: { targetDate: true, trigger: true, scheduleSlot: true, sourceKeys: true } })
  const targetDate = parent.targetDate.toISOString().slice(0, 10)
  const selected = parent.sourceKeys.filter((key) => key !== 'resmi-gazete')
  if (!selected.length) return []
  const sources = await prisma.source.findMany({ where: { key: { in: selected }, isActive: true }, select: { id: true, key: true, name: true } })
  const byKey = new Map(sources.map((source) => [source.key, source]))
  const results: SelectedSourceResult[] = []
  const failedRunIds:string[]=[]
  for (const key of selected) {
    const source = byKey.get(key)
    if (!source) { results.push({ sourceKey: key, sourceName: key, status: 'FAILED', errorSummary: 'Kaynak artık etkin değil.', documentCount: 0 }); continue }
    try {
    const run = await createSourceRun(prisma, {
      scanRunId, sourceId: source.id, targetDate, requestKey: `scan:${scanRunId}:${source.id}`,
      trigger: parent.trigger, ...(parent.scheduleSlot ? { scheduleSlot: parent.scheduleSlot } : {}),
    })
    if (run.status === 'FAILED' || run.status === 'PARTIAL') {
      await prisma.sourceScanRun.update({ where: { id: run.id }, data: { status: 'QUEUED', errorSummary: null, completedAt: null } })
    }
    if (run.status === 'RUNNING') {
      await prisma.sourceScanRun.update({ where: { id: run.id }, data: { status: 'QUEUED' } })
    }
    await executeSourceRun(prisma, run.id, tariffCredentialsFromEnv(),undefined,processing)
    const latest = await prisma.sourceScanRun.findUniqueOrThrow({ where: { id: run.id }, select: { status: true, errorSummary: true, _count: { select: { documents: true } } } })
    if(['FAILED','PARTIAL'].includes(latest.status))failedRunIds.push(run.id)
    results.push({ sourceKey: key, sourceName: source.name ?? key, status: latest.status, errorSummary: latest.errorSummary, documentCount: latest._count.documents })
    } catch (error) {
      results.push({ sourceKey: key, sourceName: source.name ?? key, status: 'FAILED', errorSummary: error instanceof Error ? error.message : 'Kaynak taranamadı.', documentCount: 0 })
    }
  }
  const failure=await sourceCaptureFailure(prisma,failedRunIds);if(failure)throw failure
  return results
}
