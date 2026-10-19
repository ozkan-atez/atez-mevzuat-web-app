import { join } from 'node:path'
import { and, eq, desc } from 'drizzle-orm'
import { type Actor, TERMINAL_RUN_STATUSES } from '@atez/contracts'
import { Orchestrator, RecipeRegistry, Reaper, StepWorker, startRun } from '@atez/engine'
import { ComponentService, TemplateService } from '@atez/modules'
import { OutboxRelay, POOLS, bootRuntime, schema, type Runtime } from '@atez/platform'
import { buildStepRegistry, createStepDeps } from '@atez/steps'

/** Internal application boundary: no HTTP server or independent scheduler. */
export async function createApplicationPipeline(source: NodeJS.ProcessEnv) {
  if (!source.STUDIO_DATABASE_URL) throw new Error('Stüdyo veritabanı yapılandırılmamış.')
  if (source.DATABASE_URL && new URL(source.STUDIO_DATABASE_URL).pathname === new URL(source.DATABASE_URL).pathname) throw new Error('Pipeline requires its separate database.')
  if (!source.V2_AMQP_URL || (source.RABBITMQ_URL && new URL(source.V2_AMQP_URL).pathname === new URL(source.RABBITMQ_URL).pathname)) throw new Error('V2 requires a separate RabbitMQ virtual host.')
  const rt = await bootRuntime('application-pipeline', { env: { ...source, DATABASE_URL: source.STUDIO_DATABASE_URL, VERTEX_PROJECT: source.VERTEX_PROJECT ?? source.GOOGLE_CLOUD_PROJECT, VERTEX_LOCATION: source.VERTEX_LOCATION ?? source.GOOGLE_CLOUD_LOCATION, AMQP_URL: source.V2_AMQP_URL } })
  if (!rt.ai) { await rt.close(); throw new Error('V2 için Vertex AI yapılandırması gerekli.') }
  const stops: Array<() => Promise<void>> = []
  let relay: OutboxRelay | undefined
  let reaper: Reaper | undefined
  try {
  const recipes = RecipeRegistry.fromDir(join(rt.configDir, 'recipes'))
  const deps = createStepDeps(rt)
  await rt.store.ensureBucket()
  const worker = new StepWorker({ db: rt.db.db, steps: buildStepRegistry(), deps, owner: `application:${process.pid}`, logger: rt.log })
  stops.push(await rt.amqp.subscribe(connection => worker.consumePools(connection, [...POOLS])))
  stops.push(await rt.amqp.subscribe(connection => new Orchestrator(rt.db.db, rt.log).consume(connection)))
  relay = new OutboxRelay(rt.db.db, rt.amqp, { idleMs: 100, logger: rt.log }); relay.start()
  reaper = new Reaper(rt.db.db, { logger: rt.log }); reaper.start()
  return {
    async start(id: string, input: { date: string; templateId?: string; templateRevision?: number }, actor: Actor) {
      const [existing] = await rt.db.db.select().from(schema.run).where(eq(schema.run.id, id))
      if (existing) {
        const owner = existing.actor as Actor
        if (owner.workspaceId !== actor.workspaceId || owner.userId !== actor.userId || existing.recipeKey !== 'daily-scan' || (existing.input as {date?:string}).date !== input.date) throw new Error('Çalışma sahibi uyuşmuyor.')
        return id
      }
      const components = new ComponentService(rt.db.db)
      await components.ensureBuiltins()
      const templates = new TemplateService(rt.db.db, components)
      const template = input.templateId ? await templates.get(input.templateId) : await templates.ensureDefault()
      if (!template) throw new Error('Seçilen şablon bulunamadı.')
      let versionId = template.versionId
      if (input.templateRevision) {
        const [version] = await rt.db.db.select().from(schema.templateVersion).where(and(eq(schema.templateVersion.templateId, template.id), eq(schema.templateVersion.version, input.templateRevision)))
        if (!version) throw new Error('Seçilen şablon sürümü bulunamadı.')
        versionId = version.id
      }
      await startRun(rt.db.db, recipes, { recipeKey: 'daily-scan', input: { date: input.date, templateVersionId: versionId }, mode: 'FORCE', forceNodes: ['discover'] }, actor, { id })
      return id
    },
    snapshot: (id: string) => pipelineSnapshot(rt, id),
    async close() { reaper?.stop(); for (const stop of stops) await stop(); await relay?.stop(); await rt.close() },
  }
  } catch(error) {
    reaper?.stop()
    for(const stop of stops)await stop().catch(()=>{})
    await relay?.stop()
    await rt.close()
    throw error
  }
}

export async function pipelineSnapshot(rt: Pick<Runtime, 'db' | 'store'>, id: string) {
  const db = rt.db.db
  const [run] = await db.select().from(schema.run).where(eq(schema.run.id, id))
  if (!run) throw new Error('İş akışı bulunamadı.')
  const items = await db.select().from(schema.workItem).where(eq(schema.workItem.runId, id))
  const steps = await db.select().from(schema.runStep).where(eq(schema.runStep.runId, id))
  const done = TERMINAL_RUN_STATUSES.includes(run.status as never)
  const date = (run.input as { date: string }).date
  const docs = done ? await db.select().from(schema.document).where(and(eq(schema.document.sourceId, 'resmi-gazete'), eq(schema.document.publishedOn, date))) : []
  const documents = []
  for (const doc of docs) {
    const files = doc.latestVersionId ? await db.select().from(schema.documentFile).where(eq(schema.documentFile.documentVersionId, doc.latestVersionId)) : []
    const [profile] = doc.latestVersionId ? await db.select().from(schema.documentProfile).where(eq(schema.documentProfile.documentVersionId, doc.latestVersionId)).orderBy(desc(schema.documentProfile.version)).limit(1) : []
    documents.push({ id: doc.id, title: doc.title, url: doc.url, context: doc.listContext, decision: profile?.decision ?? doc.titleDecision, reason: doc.titleReason ?? '', files })
  }
  const reports = []
  const reviewFailures: Array<{node:string;error:unknown}> = []
  for (const item of items.filter(i => done && i.nodeId === 'render' && i.status === 'SUCCEEDED')) {
    const output = item.output as { reportId: string; revision: number; status: string; htmlKey: string | null }
    if (output.status !== 'READY' || !output.htmlKey) { reviewFailures.push({node:'render',error:{code:'REPORT_REVIEW_REQUIRED',reportId:output.reportId}}); continue }
    const [revision] = await db.select().from(schema.reportRevision).where(and(eq(schema.reportRevision.reportId, output.reportId), eq(schema.reportRevision.revision, output.revision)))
    if (!revision) continue
    const [analysis] = await db.select().from(schema.analysis).where(eq(schema.analysis.id, revision.analysisId))
    if (!analysis) continue
    reports.push({ id: output.reportId, revision: output.revision, htmlKey: output.htmlKey, html: (await rt.store.get(output.htmlKey)).toString('utf8'), spec: JSON.parse((await rt.store.get(revision.specKey)).toString('utf8')), analysis: JSON.parse((await rt.store.get(analysis.objectKey)).toString('utf8')) })
  }
  const calls = await db.select().from(schema.aiCall).where(eq(schema.aiCall.runId, id))
  const discovery = items.find(i => i.nodeId === 'discover')?.output
  return { id, status: run.status, done, date, steps, documents, reports, calls, discovery, failures: [...items.filter(i => i.status === 'FAILED').map(i => ({ node: i.nodeId, error: i.error })), ...reviewFailures] }
}
