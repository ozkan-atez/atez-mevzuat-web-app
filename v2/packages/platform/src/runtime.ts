import { fileURLToPath } from 'node:url'
import { AiGateway, loadAiConfig, projectIdFromKeyFile, VertexProvider } from './ai/index'
import { loadEnv, type Env } from './config/env'
import { createDb, type DbHandle } from './db/client'
import { createLogger, type Logger } from './log'
import { assertTopology, connectAmqp, type AmqpHandle } from './messaging/index'
import { S3ObjectStore } from './storage/index'

export const DEFAULT_CONFIG_DIR = fileURLToPath(new URL('../../../config', import.meta.url))

/** Süreç başlangıcı için ortak kurulum (tek imaj, farklı roller — §12). */
export interface Runtime {
  env: Env
  log: Logger
  db: DbHandle
  amqp: AmqpHandle
  store: S3ObjectStore
  configDir: string
  ai: AiGateway | null
  close(): Promise<void>
}

export async function bootRuntime(role: string, opts: { amqp?: boolean } = {}): Promise<Runtime> {
  const env = loadEnv()
  const log = createLogger({ role }, env.LOG_LEVEL)
  const db = createDb(env.DATABASE_URL)
  const amqp = opts.amqp === false ? (null as unknown as AmqpHandle) : await connectAmqp(env.AMQP_URL)
  if (amqp) {
    const ch = await amqp.connection.createChannel()
    await assertTopology(ch)
    await ch.close()
  }
  const store = new S3ObjectStore({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  })
  const configDir = env.CONFIG_DIR ?? DEFAULT_CONFIG_DIR
  let ai: AiGateway | null = null
  const keyFile = env.GOOGLE_APPLICATION_CREDENTIALS
  const project = env.VERTEX_PROJECT ?? (keyFile ? projectIdFromKeyFile(keyFile) : undefined)
  if (project && env.VERTEX_LOCATION) {
    ai = new AiGateway(db.db, new VertexProvider(project, env.VERTEX_LOCATION, keyFile), loadAiConfig(configDir))
    log.info('vertex configured', { project, location: env.VERTEX_LOCATION, credentials: keyFile ? 'service-account' : 'adc' })
  } else {
    log.warn('Vertex projesi/bölgesi tanımlı değil; AI adımları çalışmaz')
  }
  return {
    env,
    log,
    db,
    amqp,
    store,
    configDir,
    ai,
    async close() {
      if (amqp) await amqp.close()
      store.destroy()
      await db.close()
    },
  }
}
