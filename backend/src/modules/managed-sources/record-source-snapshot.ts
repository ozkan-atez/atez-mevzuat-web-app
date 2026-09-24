import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'

export async function recordSourceSnapshot(prisma: PrismaClient, managedSourceId: string, input: { url: string; contentText: string | null; contentType: string | null; fetchedAt: Date | null }): Promise<void> {
  if (!input.contentText || !input.contentType) return
  const contentHash = createHash('sha256').update(input.url).update('\0').update(input.contentText).digest('hex')
  await prisma.managedSourceSnapshot.createMany({
    data: [{ managedSourceId, url: input.url, contentHash, contentText: input.contentText, contentType: input.contentType, fetchedAt: input.fetchedAt ?? new Date() }],
    skipDuplicates: true,
  })
}
