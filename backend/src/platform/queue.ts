import { PgBoss } from 'pg-boss'

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
  
  // pg-boss v9+ için kuyrukları önceden oluşturmamız gerekiyor
  await queue.createQueue('test-job')

  console.log('📦 pg-boss kuyruk sistemi başlatıldı.')
  return queue
}
