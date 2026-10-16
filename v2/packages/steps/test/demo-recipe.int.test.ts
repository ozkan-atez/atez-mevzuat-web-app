import { fileURLToPath } from 'node:url'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EXCHANGES, PARKING_QUEUE, enqueueStepCommand, schema } from '@atez/platform'
import { SYSTEM_ACTOR } from '@atez/contracts'
import { Reaper, RecipeRegistry, StepRegistry } from '@atez/engine'
import { startHarness, type Harness } from '@atez/engine/testing'
import { demoJoin, demoSplit, demoUpper, type DemoDeps } from '../src/demo'

const RECIPES = fileURLToPath(new URL('../../../config/recipes', import.meta.url))
const { run, runStep, stepResult, workItem, outbox, inbox } = schema

describe('Aşama 1: örnek tarif uçtan uca (Postgres + RabbitMQ)', () => {
  let h: Harness<{ demo: DemoDeps }>
  const deps = { demo: {} as DemoDeps }

  beforeAll(async () => {
    const steps = new StepRegistry<{ demo: DemoDeps }>().register(demoSplit, demoUpper, demoJoin)
    h = await startHarness({ steps, deps, recipes: RecipeRegistry.fromDir(RECIPES), pools: ['doc'] })
  })
  afterAll(async () => h?.stop())

  const items = (runId: string, nodeId: string) =>
    h.db.db.select().from(workItem).where(and(eq(workItem.runId, runId), eq(workItem.nodeId, nodeId))).orderBy(workItem.itemKey)
  const joinOutput = async (runId: string) => (await items(runId, 'join'))[0]?.output as { text: string; count: number } | undefined

  it('fan-out, CEL koşulu ve bariyerle tamamlanır', async () => {
    const runId = await h.start('demo-words', { text: 'alpha beta skip gamma' })
    expect(await h.waitForRun(runId)).toBe('COMPLETED')
    expect(await joinOutput(runId)).toEqual({ text: 'ALPHA BETA GAMMA', count: 3 })
    const steps = await h.db.db.select().from(runStep).where(eq(runStep.runId, runId))
    const upper = steps.find((s) => s.nodeId === 'upper')!
    expect(upper).toMatchObject({ total: 3, succeeded: 3, skipped: 1, closed: true })
    // run.finished olayı da dahil, outbox'taki her şey relay tarafından yayınlanır.
    await expect.poll(async () => (await h.db.db.select().from(outbox).where(sql`published_at IS NULL`)).length).toBe(0)
  })

  it('FILL_MISSING: ikinci çalıştırma step_result önbelleğinden gelir', async () => {
    const runId = await h.start('demo-words', { text: 'alpha beta skip gamma' })
    expect(await h.waitForRun(runId)).toBe('COMPLETED')
    const all = await h.db.db.select().from(workItem).where(eq(workItem.runId, runId))
    expect(all.every((i) => i.outcome === 'FROM_CACHE')).toBe(true)
    expect(await joinOutput(runId)).toEqual({ text: 'ALPHA BETA GAMMA', count: 3 })
  })

  it('FORCE: seçilen düğüm için yeni step_result sürümü üretir, diğerleri önbellekten', async () => {
    const runId = await h.start('demo-words', { text: 'alpha beta skip gamma' }, 'FORCE', ['upper'])
    expect(await h.waitForRun(runId)).toBe('COMPLETED')
    expect((await items(runId, 'upper')).every((i) => i.outcome === 'EXECUTED')).toBe(true)
    expect((await items(runId, 'split'))[0]!.outcome).toBe('FROM_CACHE')
    const versions = await h.db.db.select({ v: stepResult.version }).from(stepResult).where(eq(stepResult.stepKey, 'demo.upper'))
    expect(Math.max(...versions.map((v) => v.v))).toBe(2)
  })

  it('REUSE_ONLY: dış adım çalıştırılmaz, eksik olarak döner', async () => {
    const runId = await h.start('demo-words', { text: 'delta alpha' }, 'REUSE_ONLY')
    expect(await h.waitForRun(runId)).toBe('COMPLETED')
    const upper = await items(runId, 'upper')
    expect(upper.map((i) => [i.input, i.status, i.outcome])).toEqual([
      ['delta', 'SKIPPED', 'MISSING'],
      ['alpha', 'SUCCEEDED', 'FROM_CACHE'],
    ])
  })

  it('geçici hata TTL+DLX retry kuyruğundan dönüp başarılı olur', async () => {
    const runId = await h.start('demo-words', { text: 'flaky-one two' })
    expect(await h.waitForRun(runId)).toBe('COMPLETED')
    const flaky = (await items(runId, 'upper')).find((i) => i.input === 'flaky-one')!
    expect(flaky).toMatchObject({ status: 'SUCCEEDED', attempt: 2 })
    expect(await joinOutput(runId)).toEqual({ text: 'FLAKY-ONE TWO', count: 2 })
  })

  it('kalıcı hata öğeyi FAILED yapar, run durmaz → COMPLETED_WITH_ERRORS, kopya q.parking', async () => {
    const runId = await h.start('demo-words', { text: 'one boom three' })
    expect(await h.waitForRun(runId)).toBe('COMPLETED_WITH_ERRORS')
    const boom = (await items(runId, 'upper')).find((i) => i.input === 'boom')!
    expect(boom.status).toBe('FAILED')
    expect(boom.error).toMatchObject({ code: 'DEMO_BOOM' })
    expect(await joinOutput(runId)).toEqual({ text: 'ONE THREE', count: 2 })
    const ch = await h.amqp.connection.createChannel()
    const q = await ch.checkQueue(PARKING_QUEUE)
    expect(q.messageCount).toBeGreaterThanOrEqual(1)
    await ch.close()
    expect(EXCHANGES.dlx).toBe('atez.dlx')
  })

  it('aynı komutun ikinci teslimi lease/inbox ile bastırılır', async () => {
    const runId = await h.start('demo-words', { text: 'solo' })
    expect(await h.waitForRun(runId)).toBe('COMPLETED')
    const [it0] = await items(runId, 'split')
    // Aynı iş için yeni bir komut (ör. relay'in ikinci yayını) — iş zaten SUCCEEDED, tekrar çalışmaz.
    const before = await h.db.db.select({ n: sql<number>`count(*)::int` }).from(inbox)
    const env = await h.db.db.transaction((tx) =>
      enqueueStepCommand(tx, { payload: { runId, workItemId: it0!.id, stepKey: 'demo.split' }, actor: SYSTEM_ACTOR, attempt: 1 }),
    )
    expect(await h.worker.handle(env)).toBe('ack')
    const after = await h.db.db.select({ n: sql<number>`count(*)::int` }).from(inbox)
    expect(after[0]!.n).toBe(before[0]!.n)
    const [again] = await items(runId, 'split')
    expect(again!.attempt).toBe(1)
  })

  it('reaper: lease süresi dolan işi yeniden kuyruğa koyar', async () => {
    const [r] = await h.db.db
      .insert(run)
      .values({ recipeKey: 'demo-words', recipeVersion: 1, recipe: h.recipes.get('demo-words')!, mode: 'FILL_MISSING', input: {}, actor: SYSTEM_ACTOR, status: 'RUNNING' })
      .returning()
    await h.db.db.insert(runStep).values([
      { runId: r!.id, nodeId: 'split', stepKey: 'demo.split', total: 1 },
      { runId: r!.id, nodeId: 'upper', stepKey: 'demo.upper' },
      { runId: r!.id, nodeId: 'join', stepKey: 'demo.join' },
    ])
    const [wi] = await h.db.db
      .insert(workItem)
      .values({ runId: r!.id, nodeId: 'split', stepKey: 'demo.split', itemKey: 'root', input: { text: 'reaped item' }, status: 'RUNNING', attempt: 1, fence: 1, leaseOwner: 'dead-worker', leaseUntil: sql`now() - interval '1 minute'` })
      .returning()
    const res = await new Reaper(h.db.db).sweep()
    expect(res.requeued).toBe(1)
    // Yeniden kuyruğa konan iş canlı worker tarafından tamamlanır ve run biter.
    expect(await h.waitForRun(r!.id)).toBe('COMPLETED')
    const [done] = await h.db.db.select().from(workItem).where(eq(workItem.id, wi!.id))
    expect(done).toMatchObject({ status: 'SUCCEEDED', attempt: 2 })
  })
})
