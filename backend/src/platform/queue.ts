import { PgBoss } from 'pg-boss'

export const manualScanQueueName = 'resmi-gazete-manual-scan'
export const topicAnalysisQueueName = 'resmi-gazete-topic-analysis'
export const scheduledScanQueueName = 'resmi-gazete-scheduled-scan'

let boss: PgBoss | null = null

export function getQueue(): PgBoss {
  if (!boss) {
    boss = new PgBoss(process.env.DATABASE_URL!)
    
    boss.on('error', error => console.error('pg-boss error:', error))
  }
  return boss
}

export async function startQueue() {
  const queue = getQueue()
  await queue.start()
  
  await queue.createQueue(manualScanQueueName)
  await queue.createQueue(topicAnalysisQueueName)
  await queue.createQueue(scheduledScanQueueName)

  console.log('📦 pg-boss kuyruk sistemi başlatıldı.')
  return queue
}
