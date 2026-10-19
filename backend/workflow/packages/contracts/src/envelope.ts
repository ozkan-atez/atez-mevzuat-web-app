import { z } from 'zod'
import { Actor } from './actor'

/**
 * Mesaj zarfı (§12). Mesajlar yalnızca referans taşır (ID, MinIO anahtarı) — büyük
 * içerik asla zarfa gömülmez (Ek B.3 madde 1).
 */
export const Envelope = z.object({
  messageId: z.string().uuid(),
  type: z.string().min(1),
  correlationId: z.string().min(1), // runId
  idempotencyKey: z.string().min(1),
  attempt: z.number().int().min(1),
  actor: Actor,
  occurredAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
})
export type Envelope = z.infer<typeof Envelope>

/** Bir work_item'ı çalıştırma komutu. Routing key: `step.<stepKey>`. */
export const ExecuteStepPayload = z.object({
  runId: z.string().uuid(),
  workItemId: z.string().uuid(),
  stepKey: z.string().min(1),
})
export type ExecuteStepPayload = z.infer<typeof ExecuteStepPayload>

export const COMMAND_TYPES = { executeStep: 'step.execute' } as const
