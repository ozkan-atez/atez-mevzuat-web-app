import { join } from 'node:path'
import { Cron } from 'croner'
import { SYSTEM_ACTOR } from '@atez/contracts'
import { RecipeRegistry, startRun } from '@atez/engine'
import { bootRuntime, type PoolClient } from '@atez/platform'
import { loadSchedules, resolveInput } from './schedules'

/**
 * Takvim (§12): Postgres advisory lock ile tek lider. Lider olmayan örnek beklemede kalır.
 * pg-boss yok (Ek B.3 madde 4).
 */
const LOCK_KEY = 0x41_54_45_5a // "ATEZ"
const rt = await bootRuntime('scheduler', { amqp: false })
const recipes = RecipeRegistry.fromDir(join(rt.configDir, 'recipes'))
const schedules = loadSchedules(rt.configDir).filter((s) => s.enabled)
let lockClient: PoolClient | null = null
let jobs: Cron[] = []
let stopped = false

/**
 * Liderlik kilidi oturuma bağlıdır: kilidi tutan bağlantı düşerse (Postgres yeniden başlatma, 57P01)
 * kilit sunucuda serbest kalır. Süreç çökmez; cron'lar durdurulur ve kilit yeniden alınana kadar beklenir.
 */
async function becomeLeader(): Promise<void> {
  while (!stopped) {
    try {
      const client = await rt.db.pool.connect()
      client.on('error', (err) => onLockLost(client, err))
      const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY])
      if (rows[0]!.ok) {
        lockClient = client
        return
      }
      client.release()
    } catch (err) {
      rt.log.warn('scheduler lock attempt failed', { error: String(err) })
    }
    await new Promise((r) => setTimeout(r, 15_000))
  }
}

function startJobs(): void {
  jobs = schedules.map(
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
}

async function lead(): Promise<void> {
  await becomeLeader()
  if (stopped) return
  rt.log.info('scheduler is leader', { schedules: schedules.map((s) => s.key) })
  startJobs()
}

function onLockLost(client: PoolClient, err: Error): void {
  if (client !== lockClient) return
  rt.log.warn('scheduler lost its lock connection; stepping down', { error: String(err) })
  for (const j of jobs) j.stop()
  jobs = []
  lockClient = null
  client.release(err)
  void lead()
}

await lead()

const shutdown = async () => {
  stopped = true
  for (const j of jobs) j.stop()
  lockClient?.release()
  await rt.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
