import { sourceAccessWhere } from './source-access'
import type { PrismaClient } from '@prisma/client'
import { tariffCredentialsFromEnv } from './tariff-auth'

export async function listRunnableSourceKeys(prisma: PrismaClient): Promise<string[]> {
  const sources = await prisma.source.findMany({ where: {
    AND: [sourceAccessWhere()], isActive: true,
    endpoints: { some: { status: 'ACTIVE', adapter: { in: ['TICARET_DUYURULAR','TICARET_GENELGE','IGMD_MEVZUAT','MEVZUAT_GUNCELLIK','TARIFF_API','GENERIC'] } } },
  }, select: { key: true } })
  return ['resmi-gazete', ...sources.map((source) => source.key).filter((key) => key !== 'resmi-gazete' && (key !== 'tariff' || tariffCredentialsFromEnv()))]
}
