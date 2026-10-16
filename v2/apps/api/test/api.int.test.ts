import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RecipeRegistry } from '@atez/engine'
import { openTestDb, truncateAll } from '@atez/platform/testing'
import type { DbHandle } from '@atez/platform'
import { buildApi } from '../src/app'

const RECIPES = fileURLToPath(new URL('../../../config/recipes', import.meta.url))

describe('API', () => {
  let db: DbHandle
  beforeAll(async () => {
    db = await openTestDb()
    await truncateAll(db)
  })
  afterAll(async () => db?.close())

  it('run başlatır ve durumunu döner (komutlar outbox\'ta)', async () => {
    const app = buildApi({ db: db.db, recipes: RecipeRegistry.fromDir(RECIPES) })
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
})
