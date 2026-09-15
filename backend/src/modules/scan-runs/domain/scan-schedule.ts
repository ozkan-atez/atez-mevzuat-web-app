export type ScanScheduleSlotKey = 'ANA_SAYI' | 'MUKERRER_1' | 'MUKERRER_2' | 'GUN_SONU'

export interface ScanScheduleSlot {
  key: ScanScheduleSlotKey
  /** Local hour in SCAN_TIMEZONE; the cron expression is derived from it. */
  hour: number
  label: string
  description: string
}

/**
 * The single source of truth for the daily scans: the worker registers cron jobs
 * from this list and the dashboard renders its timeline from the same slots, so a
 * schedule change can never leave the two out of step.
 */
export const SCAN_SCHEDULE: readonly ScanScheduleSlot[] = [
  {
    key: 'ANA_SAYI',
    hour: 5,
    label: 'Ana Sayı',
    description: 'Günün ana Resmî Gazete sayısı taranır ve ilgili mevzuat bültene aktarılır.',
  },
  {
    key: 'MUKERRER_1',
    hour: 10,
    label: '1. Mükerrer',
    description: 'Sabah yayımlanan mükerrer sayılar taranır, yeni çıkan düzenlemeler analiz edilir.',
  },
  {
    key: 'MUKERRER_2',
    hour: 15,
    label: '2. Mükerrer',
    description: 'Öğleden sonra yayımlanan mükerrer sayılar taranır, önceki kaynak karşılaştırması yapılır.',
  },
  {
    key: 'GUN_SONU',
    hour: 23,
    label: 'Gün Sonu',
    description: 'Gün sonu kontrolü: geç yayımlanan mükerrer sayılar taranır ve gün arşivlenir.',
  },
] as const

export function cronExpressionFor(slot: ScanScheduleSlot): string {
  return `0 ${slot.hour} * * *`
}

export function scheduleRequestKey(targetDate: string, slotKey: ScanScheduleSlotKey): string {
  return `cron:${targetDate}:${slotKey}`
}

export function findScheduleSlot(key: string): ScanScheduleSlot | undefined {
  return SCAN_SCHEDULE.find((slot) => slot.key === key)
}
