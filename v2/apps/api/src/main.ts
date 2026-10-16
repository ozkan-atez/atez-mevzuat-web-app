import { join } from 'node:path'
import { RecipeRegistry } from '@atez/engine'
import { bootRuntime } from '@atez/platform'
import { buildApi } from './app'

const rt = await bootRuntime('api', { amqp: false })
const app = buildApi({ db: rt.db.db, recipes: RecipeRegistry.fromDir(join(rt.configDir, 'recipes')) })
const port = Number(process.env.PORT ?? 3100)
await app.listen({ port, host: '127.0.0.1' })
rt.log.info('api listening', { port })
