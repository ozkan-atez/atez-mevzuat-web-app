import { z } from 'zod'

/** Çalışma modları (§5.2). */
export const RunMode = z.enum(['REUSE_ONLY', 'FILL_MISSING', 'FORCE'])
export type RunMode = z.infer<typeof RunMode>

export const RunStatus = z.enum([
  'RUNNING',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
  'CANCELLED',
  'WAITING_INPUT',
])
export type RunStatus = z.infer<typeof RunStatus>
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED']

/** Görev durumları (Ek B.4 Ç6). `NOT_FOUND` bir sonuçtur, durum değildir. */
export const WorkItemStatus = z.enum([
  'PENDING_DEPENDENCIES',
  'READY',
  'RUNNING',
  'SUCCEEDED',
  'RETRY_SCHEDULED',
  'WAITING_INPUT',
  'REVIEW_REQUIRED',
  'FAILED',
  'CANCELLED',
  'SKIPPED',
])
export type WorkItemStatus = z.infer<typeof WorkItemStatus>
export const TERMINAL_ITEM_STATUSES: readonly WorkItemStatus[] = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED']

/** Bir öğenin adımda nasıl sonuçlandığı (§5.3 sonuç türleri). */
export const WorkItemOutcome = z.enum([
  'EXECUTED', // adım çalıştı, yeni step_result yazıldı
  'FROM_CACHE', // step_result yeniden kullanıldı (ÖNBELLEKTEN)
  'MISSING', // REUSE_ONLY: önbellekte yok, dış çağrı yapılmadı
  'FILTERED', // `when` koşulu nedeniyle atlandı
])
export type WorkItemOutcome = z.infer<typeof WorkItemOutcome>
