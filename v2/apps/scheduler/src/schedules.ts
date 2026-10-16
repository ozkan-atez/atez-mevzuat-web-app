import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export const Schedule = z.object({
  key: z.string(),
  cron: z.string(),
  timezone: z.string().default('Europe/Istanbul'),
  recipeKey: z.string(),
  /** `"$today"` değeri tetik anında saat dilimine göre YYYY-MM-DD olur. */
  input: z.record(z.string(), z.unknown()).default({}),
  mode: z.enum(['REUSE_ONLY', 'FILL_MISSING', 'FORCE']).default('FILL_MISSING'),
  enabled: z.boolean().default(true),
})
export type Schedule = z.infer<typeof Schedule>

export const loadSchedules = (configDir: string): Schedule[] =>
  z.array(Schedule).parse(JSON.parse(readFileSync(join(configDir, 'schedules.json'), 'utf8')))

export function resolveInput(input: Record<string, unknown>, timezone: string, now = new Date()): Record<string, unknown> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v === '$today' ? today : v]))
}
