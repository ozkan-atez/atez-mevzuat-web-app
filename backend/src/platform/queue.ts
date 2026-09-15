import { PgBoss } from 'pg-boss'

export const manualScanQueueName = 'resmi-gazete-manual-scan'
export const topicAnalysisQueueName = 'resmi-gazete-topic-analysis'
export const scheduledScanQueueName = 'resmi-gazete-scheduled-scan'

/**
 * Liveness is decided by heartbeats, not by a deadline.
 *
 * A gazette scan legitimately runs for an hour or more, so the 15-minute default
 * expiry declared healthy runs dead, redelivered them, and — because the run was
 * already RUNNING — the redelivery did nothing and the run hung forever. The
 * expiry is now a last-resort ceiling; a worker that dies is noticed within a
 * minute because its heartbeat stops.
 */
const longRunningQueue = {
  expireInSeconds: 4 * 60 * 60,
  heartbeatSeconds: 60,
  retryLimit: 2,
} as const

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

  for (const name of [manualScanQueueName, topicAnalysisQueueName, scheduledScanQueueName]) {
    await queue.createQueue(name, longRunningQueue)
    // createQueue leaves an existing queue alone, so settings would never reach a
    // deployment that already has these queues.
    await queue.updateQueue(name, longRunningQueue)
  }

  console.log('📦 pg-boss kuyruk sistemi başlatıldı.')
  return queue
}
