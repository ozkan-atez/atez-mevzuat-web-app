import type { PrismaClient } from '@prisma/client'

/**
 * Wipes scan runs and every stored object in the isolated test database.
 *
 * Collection now also archives each fetched original into the document
 * archive (Document -> DocumentVersion -> StoredObject, all onDelete: Restrict),
 * so the archive rows must go before the stored objects they point at.
 */
export async function resetScanStorage(prisma: PrismaClient): Promise<void> {
  await prisma.scanRun.deleteMany()
  await prisma.documentImport.deleteMany({ where: { documentVersionId: { not: null } } })
  await prisma.documentVersion.deleteMany()
  await prisma.document.deleteMany()
  await prisma.storedObject.deleteMany()
}
