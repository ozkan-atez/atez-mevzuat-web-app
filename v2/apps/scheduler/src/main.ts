import { join } from 'node:path'
import { Cron } from 'croner'
import { SYSTEM_ACTOR } from '@atez/contracts'
import { RecipeRegistry, startRun } from '@atez/engine'
import { bootRuntime } from '@atez/platform'
import { loadSchedules, resolveInput } from './schedules'

/**
 * Takvim (§12): Postgres advisory lock ile tek lider. Lider olmayan örnek beklemede kalır.
 * pg-boss yok (Ek B.3 madde 4).
 */
const LOCK_KEY = 0x41_54_45_5a // "ATEZ"
const rt = await bootRuntime('scheduler', { amqp: false })
const recipes = RecipeRegistry.fromDir(join(rt.configDir, 'recipes'))
const schedules = loadSchedules(rt.configDir).filter((s) => s.enabled)
const lockClient = await rt.db.pool.connect()

async function becomeLeader(): Promise<void> {
  for (;;) {
    const { rows } = await lockClient.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY])
    if (rows[0]!.ok) return
    await new Promise((r) => setTimeout(r, 15_000))
  }
}

await becomeLeader()
rt.log.info('scheduler is leader', { schedules: schedules.map((s) => s.key) })
const jobs = schedules.map(
  (s) =>
    new Cron(s.cron, { timezone: s.timezone, protect: true }, async () => {
      const input = resolveInput(s.input, s.timezone)
      try {
        const run = await startRun(rt.db.db, recipes, { recipeKey: s.recipeKey, input, mode: s.mode }, SYSTEM_ACTOR)
        rt.log.info('scheduled run started', { schedule: s.key, ...run, input })
      } catch (err) {
        rt.log.error('scheduled run failed to start', { schedule: s.key, error: String(err) })
      }
    }),
)

const shutdown = async () => {
  for (const j of jobs) j.stop()
  lockClient.release()
  await rt.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
