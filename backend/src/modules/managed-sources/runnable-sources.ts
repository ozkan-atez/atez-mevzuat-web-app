import type { PrismaClient } from '@prisma/client'
import { tariffCredentialsFromEnv } from './tariff-auth'

export async function listRunnableSourceKeys(prisma: PrismaClient): Promise<string[]> {
  const sources = await prisma.source.findMany({ where: {
    isActive: true,
    endpoints: { some: { status: 'ACTIVE', adapter: { not: null } } },
  }, select: { key: true } })
  return ['resmi-gazete', ...sources.map((source) => source.key).filter((key) => key !== 'resmi-gazete' && (key !== 'tariff' || tariffCredentialsFromEnv()))]
}
