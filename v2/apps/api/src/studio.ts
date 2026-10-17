import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ComponentCategory, ComponentDefinition, TemplateDefinition } from '@atez/contracts'
import {
  AiStudio,
  BINDING_CATALOG,
  ComponentService,
  SAMPLE_CONTEXT,
  TEMPLATE_TOOLS,
  TemplateService,
  ValidationFailed,
  applyDescriptions, applyCompiled,
  loadShell,
  renderComponentPreview,
  runTemplateTool,
  validateComponent,
  type TemplateToolName,
} from '@atez/modules'
import { PermanentError, type AiGateway, type Db } from '@atez/platform'

/**
 * Şablon stüdyosu ve bileşen havuzu API'si (§10.1). AI uçları yalnızca taslak/öneri döner;
 * kayıt ayrı uçlarla, kullanıcının açık isteğiyle yapılır.
 */
export async function registerStudio(app: FastifyInstance, deps: { db: Db; ai: AiGateway | null; configDir: string }) {
  const components = new ComponentService(deps.db)
  const templates = new TemplateService(deps.db, components)
  const shell = loadShell(deps.configDir)
  const studio = deps.ai ? new AiStudio(deps.ai, deps.configDir, shell) : null
  await components.ensureBuiltins()
  await templates.ensureSeed()
  await templates.ensureDefault()

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationFailed) return reply.code(422).send({ error: 'VALIDATION_FAILED', issues: err.issues })
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'INVALID_REQUEST', issues: err.issues })
    if (err instanceof PermanentError) return reply.code(err.code === 'NOT_FOUND' ? 404 : 409).send({ error: err.code, message: err.message })
    reply.log?.error?.(err)
    return reply.code(500).send({ error: 'INTERNAL', message: err instanceof Error ? err.message : String(err) })
  })
  const needAi = () => {
    if (!studio) throw new PermanentError('AI yapılandırılmamış (VERTEX_LOCATION / kimlik)', 'AI_NOT_CONFIGURED')
    return studio
  }

  // ---- Bileşenler ----
  app.get('/bindings', async () => BINDING_CATALOG)
  app.get<{ Querystring: { category?: string; status?: string; origin?: string } }>('/components', async (req) => {
    const list = await components.list(req.query)
    return Promise.all(list.map(async (c) => ({ ...c, usage: await components.usage(c.key) })))
  })
  app.get<{ Params: { id: string } }>('/components/:id', async (req, reply) => (await components.get(req.params.id)) ?? reply.code(404).send({ error: 'NOT_FOUND' }))
  app.get<{ Params: { id: string }; Querystring: { version?: string } }>('/components/:id/preview', async (req, reply) => {
    const c = await components.get(req.params.id)
    if (!c) return reply.code(404).send({ error: 'NOT_FOUND' })
    const def = req.query.version ? c.versions.find((v) => v.version === Number(req.query.version))?.definition : c.definition
    if (!def) return reply.code(404).send({ error: 'VERSION_NOT_FOUND' })
    return { html: renderComponentPreview(shell, c.name, def, SAMPLE_CONTEXT) }
  })
  /** Kaydetmeden doğrula + önizle (editör ve AI taslağı için). */
  app.post('/components/validate', async (req) => {
    const body = z.object({ name: z.string().default('Önizleme'), definition: z.unknown() }).parse(req.body)
    const v = validateComponent(body.definition)
    return { ok: v.ok, issues: v.issues, definition: v.definition, html: v.definition ? renderComponentPreview(shell, body.name, v.definition, SAMPLE_CONTEXT) : null }
  })
  app.post('/components', async (req, reply) => {
    const body = z
      .object({ key: z.string().regex(/^[a-z][a-z0-9-]{1,47}$/).optional(), name: z.string().min(1).max(120), description: z.string().max(1000), category: ComponentCategory, origin: z.enum(['USER', 'AI']), definition: z.unknown(), activate: z.boolean().default(false) })
      .parse(req.body)
    return reply.code(201).send(await components.create(body))
  })
  app.post<{ Params: { id: string } }>('/components/:id/versions', async (req) => {
    const body = z.object({ definition: z.unknown(), note: z.string().max(400).optional(), name: z.string().max(120).optional(), description: z.string().max(1000).optional() }).parse(req.body)
    return components.addVersion(req.params.id, body)
  })
  app.patch<{ Params: { id: string } }>('/components/:id', async (req) => {
    const body = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }).parse(req.body)
    await components.setStatus(req.params.id, body.status)
    return { ok: true }
  })
  app.delete<{ Params: { id: string } }>('/components/:id', async (req) => components.remove(req.params.id))
  app.post('/components/ai/draft', async (req) => {
    const body = z
      .object({
        request: z.string().min(3).max(2000),
        base: z.object({ name: z.string(), description: z.string(), category: ComponentCategory, definition: ComponentDefinition }).nullable().optional(),
        conversation: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).max(20).optional(),
      })
      .parse(req.body)
    return needAi().draftComponent(body)
  })

  // ---- Şablonlar ----
  app.get('/templates', async () => templates.list())
  app.post('/templates', async (req, reply) => {
    const body = z.object({ title: z.string().min(1).max(160), description: z.string().max(1000).optional(), brief: z.string().max(4000).optional() }).parse(req.body)
    return reply.code(201).send(await templates.create(body))
  })
  app.get<{ Params: { id: string } }>('/templates/:id', async (req, reply) => (await templates.get(req.params.id)) ?? reply.code(404).send({ error: 'NOT_FOUND' }))
  app.put<{ Params: { id: string } }>('/templates/:id', async (req) => templates.save(req.params.id, (req.body as { definition: unknown }).definition))
  app.delete<{ Params: { id: string } }>('/templates/:id', async (req) => templates.remove(req.params.id))
  app.post<{ Params: { id: string } }>('/templates/:id/default', async (req) => {
    await templates.setDefault(req.params.id)
    return { ok: true }
  })
  app.post('/templates/preview', async (req) => templates.preview((req.body as { definition: unknown }).definition, shell))
  app.post('/templates/ai/describe', async (req) => {
    const body = z.object({ definition: z.unknown() }).parse(req.body)
    const t = TemplateDefinition.parse(body.definition)
    const comps: Record<string, { name: string; description: string; slots: { key: string; instruction: string }[] }> = {}
    for (const s of t.sections) {
      const c = await components.definitionOf(s.componentKey, s.componentVersion)
      if (c) comps[s.componentKey] = { name: c.name, description: c.description, slots: c.definition.slots }
    }
    const res = await needAi().suggestSectionDescriptions({ template: t, components: comps })
    return { suggestions: res.suggestions, definition: applyDescriptions(t, res.suggestions) }
  })

  app.post('/templates/ai/compile', async (req) => {
    const body = z.object({ definition: z.unknown() }).parse(req.body)
    const t = TemplateDefinition.parse(body.definition)
    const comps: Record<string, { name: string; description: string; slots: { key: string; instruction: string }[] }> = {}
    for (const s of t.sections.filter((x) => x.enabled)) {
      const c = await components.definitionOf(s.componentKey, s.componentVersion)
      if (c) comps[s.componentKey] = { name: c.name, description: c.description, slots: c.definition.slots }
    }
    const res = await needAi().compileRequest({ template: t, components: comps })
    return { compiled: { brief: res.brief, sections: res.sections }, definition: applyCompiled(t, res) }
  })

  // ---- Asistan araç paketi `templates` (chat arayüzü kendi aşamasında bağlanır) ----
  app.get('/assistant/tools/templates', async () => TEMPLATE_TOOLS)
  app.post<{ Params: { name: string } }>('/assistant/tools/templates/:name', async (req, reply) => {
    if (!TEMPLATE_TOOLS.some((t) => t.name === req.params.name)) return reply.code(404).send({ error: 'UNKNOWN_TOOL' })
    return runTemplateTool(req.params.name as TemplateToolName, req.body ?? {}, { components, templates, studio, shell })
  })
}
