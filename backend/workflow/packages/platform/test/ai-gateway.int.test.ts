import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AiGateway, DEFAULT_AI_CONFIG, FakeProvider, ProviderError, TransientError, schema, type DbHandle } from '../src/index'
import { openTestDb, truncateAll } from '../src/testing/index'

describe('AI geçidi: tek ai_call kaydı', () => {
  let db: DbHandle
  beforeAll(async () => {
    db = await openTestDb()
    await truncateAll(db)
  })
  afterAll(async () => db?.close())

  it('başarılı çağrıyı model ve token bilgisiyle kaydeder', async () => {
    const gw = new AiGateway(db.db, new FakeProvider(() => ({ ok: true })), { ...DEFAULT_AI_CONFIG, pricing: { 'gemini-3.5-flash-lite': { inputPerM: 0.1, outputPerM: 0.4 } } })
    const res = await gw.generate({ tier: 'lite', purpose: 'test', promptVersion: 'p1', parts: [{ text: 'merhaba' }], schema: z.object({ ok: z.boolean() }) })
    expect(res.data).toEqual({ ok: true })
    const [row] = await db.db.select().from(schema.aiCall).where(eq(schema.aiCall.id, res.aiCallId))
    expect(row).toMatchObject({ status: 'OK', model: 'gemini-3.5-flash-lite', tier: 'lite', inputTokens: 100, outputTokens: 20, costUsd: '0.000018' })
  })

  it('ana model gemini-3.8-flash', () => {
    expect(DEFAULT_AI_CONFIG.models.main).toBe('gemini-3.8-flash')
  })

  it('geçici sağlayıcı hatasını kaydeder ve TransientError fırlatır', async () => {
    const gw = new AiGateway(db.db, new FakeProvider(() => new ProviderError('429', true, 429)), DEFAULT_AI_CONFIG)
    await expect(gw.generate({ tier: 'main', purpose: 'test', promptVersion: 'p1', parts: [{ text: 'x' }] })).rejects.toBeInstanceOf(TransientError)
    const rows = await db.db.select().from(schema.aiCall).where(eq(schema.aiCall.status, 'ERROR'))
    expect(rows.length).toBe(1)
    expect(rows[0]!.inputTokens).toBeNull()
  })

  it('şemaya uymayan çıktıyı INVALID_OUTPUT olarak kaydeder', async () => {
    const gw = new AiGateway(db.db, new FakeProvider(() => ({ wrong: 1 })), DEFAULT_AI_CONFIG)
    await expect(gw.generate({ tier: 'main', purpose: 'test', promptVersion: 'p1', parts: [{ text: 'x' }], schema: z.object({ ok: z.boolean() }) })).rejects.toThrow(/şemaya uymuyor/)
    const rows = await db.db.select().from(schema.aiCall).where(eq(schema.aiCall.status, 'INVALID_OUTPUT'))
    expect(rows.length).toBe(1)
  })
})
