import { join } from 'node:path'
import { RecipeRegistry } from '@atez/engine'
import { bootRuntime } from '@atez/platform'
import { buildApi } from './app'

const rt = await bootRuntime('api', { amqp: false })
const app = await buildApi({ db: rt.db.db, recipes: RecipeRegistry.fromDir(join(rt.configDir, 'recipes')), configDir: rt.configDir, ai: rt.ai })
const port = Number(process.env.PORT ?? 3100)
// Yerelde yalnızca loopback; container'da HOST=0.0.0.0 (erişim ağ ve web katmanındaki oturum kontrolüyle sınırlanır).
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' })
rt.log.info('api listening', { port })
