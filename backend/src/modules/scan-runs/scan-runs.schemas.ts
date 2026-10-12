import { DateTime } from 'luxon'
import { z } from 'zod'

export const idempotencyKeySchema = z.string().uuid()

export const createScanRunSchema = z.object({
  trigger: z.literal('MANUAL'),
  sourceKeys: z.array(z.string().min(1).max(150)).min(1).max(30).optional(),
  datePolicy: z.enum(['PUBLISHED_DATE','NEW_OR_CHANGED']).optional(),
  targetDate: z.string().refine((value) => {
    const parsed = DateTime.fromFormat(value, 'yyyy-MM-dd', { zone: 'Europe/Istanbul' })
    return parsed.isValid && parsed.toFormat('yyyy-MM-dd') === value
  }, 'targetDate must be a valid YYYY-MM-DD calendar date'),
})
