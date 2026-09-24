import type { PrismaClient } from '@prisma/client'

const priority: Record<string, number> = { OFFICIAL: 0, PROFESSIONAL: 1, COMMERCIAL: 2, UNVERIFIED: 3 }

/** User-added sites never acquire official rank from their own metadata. */
export async function sourcePriority(prisma: PrismaClient, managedSources: Array<{ id: string; url: string }>): Promise<Map<string, number>> {
  if (!managedSources.length) return new Map()
  const urls = new Map(managedSources.map((source) => [source.id, source.url]))
  const endpoints = await prisma.sourceEndpoint.findMany({
    where: { status: 'ACTIVE', managedSourceId: { in: managedSources.map((source) => source.id) } },
    select: { managedSourceId: true, url: true, source: { select: { authorityType: true } } },
  })
  const ranks = new Map<string, number>()
  for (const endpoint of endpoints) {
    if (!endpoint.managedSourceId || urls.get(endpoint.managedSourceId) !== endpoint.url) continue
    ranks.set(endpoint.managedSourceId, Math.min(ranks.get(endpoint.managedSourceId) ?? 4, priority[endpoint.source.authorityType] ?? 3))
  }
  return ranks
}
