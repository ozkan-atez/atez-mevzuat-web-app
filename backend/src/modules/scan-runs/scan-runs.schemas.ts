import { DateTime } from 'luxon'
import { z } from 'zod'

export const idempotencyKeySchema = z.string().uuid()

export const createScanRunSchema = z.object({
  trigger: z.literal('MANUAL'),
  targetDate: z.string().refine((value) => {
    const parsed = DateTime.fromFormat(value, 'yyyy-MM-dd', { zone: 'Europe/Istanbul' })
    return parsed.isValid && parsed.toFormat('yyyy-MM-dd') === value
  }, 'targetDate must be a valid YYYY-MM-DD calendar date'),
})
