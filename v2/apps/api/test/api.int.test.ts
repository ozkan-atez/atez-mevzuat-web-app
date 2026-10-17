import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RecipeRegistry } from '@atez/engine'
import { openTestDb, truncateAll } from '@atez/platform/testing'
import type { DbHandle } from '@atez/platform'
import { buildApi } from '../src/app'

const RECIPES = fileURLToPath(new URL('../../../config/recipes', import.meta.url))
const CONFIG = fileURLToPath(new URL('../../../config', import.meta.url))

describe('API', () => {
  let db: DbHandle
  beforeAll(async () => {
    db = await openTestDb()
    await truncateAll(db)
  })
  afterAll(async () => db?.close())

  it('run başlatır ve durumunu döner (komutlar outbox\'ta)', async () => {
    const app = await buildApi({ db: db.db, recipes: RecipeRegistry.fromDir(RECIPES), configDir: CONFIG, ai: null })
    const bad = await app.inject({ method: 'POST', url: '/runs', payload: { recipeKey: 'yok' } })
    expect(bad.statusCode).toBe(404)
    const res = await app.inject({ method: 'POST', url: '/runs', payload: { recipeKey: 'demo-words', input: { text: 'a b' } } })
    expect(res.statusCode).toBe(202)
    const { runId } = res.json() as { runId: string }
    const got = await app.inject({ method: 'GET', url: `/runs/${runId}` })
    expect(got.json()).toMatchObject({ id: runId, status: 'RUNNING', mode: 'FILL_MISSING' })
    const items = await app.inject({ method: 'GET', url: `/runs/${runId}/items` })
    expect(items.json()).toHaveLength(1)
  })

  it('stüdyo: yerleşik bileşenler, önizleme, yeni şablon, doğrulama hatası', async () => {
    const app = await buildApi({ db: db.db, recipes: RecipeRegistry.fromDir(RECIPES), configDir: CONFIG, ai: null })
    const comps = (await app.inject({ method: 'GET', url: '/api/components' })).json() as { id: string; key: string; status: string }[]
    expect(comps.length).toBeGreaterThanOrEqual(14)
    const prev = (await app.inject({ method: 'GET', url: `/api/components/${comps[0]!.id}/preview` })).json() as { html: string }
    expect(prev.html).toContain('<!DOCTYPE html>')
    const t = await app.inject({ method: 'POST', url: '/api/templates', payload: { title: 'Deneme', brief: 'x' } })
    expect(t.statusCode).toBe(201)
    const bad = await app.inject({ method: 'POST', url: '/api/components', payload: { name: 'X', description: '', category: 'OZET', origin: 'USER', definition: { schemaVersion: 1, nodes: [{ type: 'text', bind: 'analysis.yok' }], slots: [], appliesWhen: '', bindings: [], sampleData: { slots: {} } } } })
    expect(bad.statusCode).toBe(422)
    const ai = await app.inject({ method: 'POST', url: '/api/components/ai/draft', payload: { request: 'tablo' } })
    expect(ai.statusCode).toBe(409)
  })
})
