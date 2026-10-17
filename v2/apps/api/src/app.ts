import Fastify, { type FastifyInstance } from 'fastify'
import { and, asc, eq } from 'drizzle-orm'
import { StartRunRequest, SYSTEM_ACTOR } from '@atez/contracts'
import { RecipeRegistry, startRun } from '@atez/engine'
import { schema, type AiGateway, type Db } from '@atez/platform'
import { registerStudio } from './studio'

/**
 * REST API (Aşama 1 asgari yüzeyi). Kimlik: Keycloak bağlanana kadar sistem aktörü
 * (K9, `AuthProvider` arayüzü Aşama 8'de).
 */
export async function buildApi(deps: { db: Db; recipes: RecipeRegistry; configDir: string; ai: AiGateway | null }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 })
  await app.register(async (scoped) => registerStudio(scoped, deps), { prefix: '/api' })

  app.get('/health', async () => ({ ok: true }))
  app.get('/recipes', async () => deps.recipes.list().map((r) => ({ key: r.key, version: r.version, title: r.title })))

  app.post('/runs', async (req, reply) => {
    const parsed = StartRunRequest.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST', issues: parsed.error.issues })
    if (!deps.recipes.get(parsed.data.recipeKey)) return reply.code(404).send({ error: 'RECIPE_NOT_FOUND' })
    const run = await startRun(deps.db, deps.recipes, parsed.data, SYSTEM_ACTOR)
    return reply.code(202).send(run)
  })

  app.get<{ Params: { id: string } }>('/runs/:id', async (req, reply) => {
    const [run] = await deps.db.select().from(schema.run).where(eq(schema.run.id, req.params.id))
    if (!run) return reply.code(404).send({ error: 'NOT_FOUND' })
    const steps = await deps.db.select().from(schema.runStep).where(eq(schema.runStep.runId, run.id))
    const { recipe: _recipe, ...rest } = run
    return { ...rest, steps }
  })

  app.get<{ Params: { id: string }; Querystring: { node?: string } }>('/runs/:id/items', async (req) => {
    const where = req.query.node
      ? and(eq(schema.workItem.runId, req.params.id), eq(schema.workItem.nodeId, req.query.node))
      : eq(schema.workItem.runId, req.params.id)
    return deps.db
      .select({
        id: schema.workItem.id,
        nodeId: schema.workItem.nodeId,
        itemKey: schema.workItem.itemKey,
        status: schema.workItem.status,
        outcome: schema.workItem.outcome,
        attempt: schema.workItem.attempt,
        error: schema.workItem.error,
      })
      .from(schema.workItem)
      .where(where)
      .orderBy(asc(schema.workItem.nodeId), asc(schema.workItem.itemKey))
  })

  return app
}

