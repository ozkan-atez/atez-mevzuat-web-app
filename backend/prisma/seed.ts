import { PrismaClient } from '@prisma/client'
import { ensureWorkspaceCatalog } from '../src/modules/workspace/catalog'
const prisma = new PrismaClient()
ensureWorkspaceCatalog(prisma).then(() => console.log('Kaynak ve şablon kataloğu hazır.')).finally(() => prisma.$disconnect()).catch(() => { console.error('Katalog hazırlanamadı.'); process.exitCode = 1 })
