import { startQueue } from './platform/queue'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function startWorker() {
  const queue = await startQueue()
  
  console.log('👷 Worker arka plan işlerini bekliyor...')

  await queue.work('test-job', async (jobs: any) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs]
    
    for (const job of jobList) {
      console.log(`[WORKER] İş teslim alındı! pg-boss ID: ${job.id}`)
      
      const dbJobId = (job.data as any).dbJobId
      console.log(`[WORKER] İlgili Veritabanı Job ID: ${dbJobId}`)

      // Yapay bir gecikme ekliyoruz
      await new Promise(resolve => setTimeout(resolve, 2000))

      // İş bittiğinde veritabanındaki durumunu güncelliyoruz
      if (dbJobId) {
        await prisma.workflowRun.updateMany({
          where: { id: dbJobId },
          data: { status: 'COMPLETED' }
        })
        console.log(`[WORKER] ✅ İş ${dbJobId} başarıyla tamamlandı ve veritabanına COMPLETED yazıldı.`)
      }
    }
  })
}

startWorker().catch(err => {
  console.error('Worker başlatılırken hata oluştu:', err)
  process.exit(1)
})
