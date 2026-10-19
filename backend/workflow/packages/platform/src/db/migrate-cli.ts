import { loadEnv } from '../config/env'
import { createDb } from './client'
import { runMigrations } from './migrate'

const env = loadEnv()
const handle = createDb(env.DATABASE_URL, { max: 1 })
await runMigrations(handle.db)
await handle.close()
console.log('migrations applied')
