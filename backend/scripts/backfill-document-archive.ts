import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { backfillDocumentArchive } from '../src/modules/documents/application/backfill-document-archive'

async function main(){
  const args=process.argv.slice(2)
  if(args.some(arg=>!['--apply','--dry-run'].includes(arg)))throw new Error('Kullanım: backfill-document-archive.ts [--dry-run | --apply]')
  if(args.includes('--apply')&&args.includes('--dry-run'))throw new Error('Tek çalışma seçeneği kullanın.')
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL açıkça yapılandırılmalıdır.')
  const prisma=new PrismaClient()
  try{console.log(JSON.stringify(await backfillDocumentArchive(prisma,{apply:args.includes('--apply')}),null,2))}finally{await prisma.$disconnect()}
}
main().catch(()=>{console.error('Belge arşivi eşlemesi tamamlanamadı; veritabanı bağlantısını ve migration durumunu kontrol edin.');process.exitCode=1})
