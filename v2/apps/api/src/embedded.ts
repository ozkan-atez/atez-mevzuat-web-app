import Fastify, { type FastifyInstance, type HTTPMethods } from 'fastify'
import { bootRuntime, type AiGateway, type Db } from '@atez/platform'
import { registerStudio } from './studio'
import { registerLegacyReports } from './legacy-reports'

/** Only template functionality is embedded; V2 pipeline and scheduler remain separate. */
export async function buildEmbeddedStudio(deps: { db: Db; ai: AiGateway | null; configDir: string }) {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 })
  await app.register(async scoped => registerStudio(scoped, deps), { prefix: '/api' })
  await app.register(async scoped => registerLegacyReports(scoped, deps))
  await app.ready()
  return app
}

export function studioFetchAdapter(app: FastifyInstance): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init)
    request.signal.throwIfAborted()
    const url = new URL(request.url)
    const payload = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text()
    const result = await app.inject({
      method: request.method as HTTPMethods,
      url: url.pathname + url.search,
      headers: payload ? { 'content-type': request.headers.get('content-type') ?? 'application/json' } : {},
      ...(payload ? { payload } : {}),
    })
    request.signal.throwIfAborted()
    return new Response([204, 205, 304].includes(result.statusCode) ? null : result.body, {
      status: result.statusCode,
      headers: { 'content-type': String(result.headers['content-type'] ?? 'application/json') },
    })
  }
}

export async function createEmbeddedStudio(source: NodeJS.ProcessEnv) {
  if (!source.STUDIO_DATABASE_URL) throw new Error('STUDIO_DATABASE_URL is required for the embedded studio.')
  if (new URL(source.STUDIO_DATABASE_URL).pathname === new URL(source.DATABASE_URL!).pathname) {
    throw new Error('Studio must retain its separate database; refusing to use the application database.')
  }
  const rt = await bootRuntime('embedded-studio', {
    amqp: false,
    env: { ...source, DATABASE_URL: source.STUDIO_DATABASE_URL },
  })
  try {
    const app = await buildEmbeddedStudio({ db: rt.db.db, ai: rt.ai, configDir: rt.configDir })
    return { fetch: studioFetchAdapter(app), close: async () => { await app.close(); await rt.close() } }
  } catch (error) {
    await rt.close()
    throw error
  }
}
