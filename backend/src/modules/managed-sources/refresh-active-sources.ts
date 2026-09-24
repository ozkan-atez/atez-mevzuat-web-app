import type { PrismaClient } from '@prisma/client'
import { fetchManagedSource } from './fetch-managed-source'
import { recordSourceSnapshot } from './record-source-snapshot'

/** Refresh only approved links. New versions are retained, while a failed fetch keeps the last good text. */
export async function refreshActiveSources(prisma: PrismaClient, now = new Date()): Promise<{ refreshed: number; failed: number }> {
  const endpoints = await prisma.sourceEndpoint.findMany({
    where: { status: 'ACTIVE', source: { isActive: true }, managedSourceId: { not: null } },
    select: { managedSourceId: true }, take: 100,
  })
  let refreshed = 0
  let failed = 0
  for (const endpoint of endpoints) {
    const id = endpoint.managedSourceId!
    const source = await prisma.managedSource.findUnique({ where: { id } })
    if (!source?.isActive || !source.useInChat && !source.useInRuns) continue
    if (source.fetchedAt && now.getTime() - source.fetchedAt.getTime() < 6 * 60 * 60_000) continue
    try {
      const fetched = await fetchManagedSource(source.url)
      if (!fetched.contentText) throw new Error('Okunabilir metin çıkarılamadı.')
      await prisma.managedSource.update({ where: { id }, data: { ...fetched, fetchError: null } })
      await recordSourceSnapshot(prisma, id, { url: source.url, ...fetched })
      refreshed++
    } catch (error) {
      await prisma.managedSource.update({ where: { id }, data: { fetchError: error instanceof Error ? error.message.slice(0, 300) : 'Kaynak okunamadı.' } })
      failed++
    }
  }
  return { refreshed, failed }
}
