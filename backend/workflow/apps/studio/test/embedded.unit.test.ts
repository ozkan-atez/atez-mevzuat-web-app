import { describe, expect, it, vi } from 'vitest'
import { buildEmbeddedStudio, createEmbeddedStudio, studioFetchAdapter } from '../src/embedded'

vi.mock('../src/studio', () => ({ registerStudio: async (app: any) => {
  app.get('/templates', async (req: any) => ({ query: req.query, cookie: req.headers.cookie ?? null }))
  app.post('/components', async (req: any, reply: any) => reply.code(201).send(req.body))
  app.delete('/components/:id', async (_req: any, reply: any) => reply.code(204).send())
} }))
vi.mock('../src/legacy-reports', () => ({ registerLegacyReports: async (app: any) => {
  app.post('/integration/render', async (req: any) => ({ html: req.body.html }))
} }))

describe('embedded studio', () => {
  it('serves studio and internal rendering without opening a port or exposing pipeline routes', async () => {
    const app = await buildEmbeddedStudio({ db: {} as any, ai: null, configDir: '' })
    try {
      const fetch = studioFetchAdapter(app)
      const list = await fetch('http://embedded-studio/api/templates?q=test', { headers: { cookie: 'private' } })
      expect(await list.json()).toEqual({ query: { q: 'test' }, cookie: null })
      const created = await fetch('http://embedded-studio/api/components', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"Kart"}' })
      expect(created.status).toBe(201)
      expect(await created.json()).toEqual({ name: 'Kart' })
      expect((await fetch('http://embedded-studio/api/components/1', { method: 'DELETE' })).status).toBe(204)
      const rendered = await fetch('http://embedded-studio/integration/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"html":"<p>Rapor</p>"}' })
      expect(await rendered.json()).toEqual({ html: '<p>Rapor</p>' })
      expect((await fetch('http://embedded-studio/runs')).status).toBe(404)
      expect(app.server.listening).toBe(false)
    } finally { await app.close() }
  })

  it('refuses missing or application database configuration before booting', async () => {
    await expect(createEmbeddedStudio({})).rejects.toThrow('STUDIO_DATABASE_URL')
    await expect(createEmbeddedStudio({ DATABASE_URL: 'postgres://localhost/atez_db', STUDIO_DATABASE_URL: 'postgres://localhost/atez_db' })).rejects.toThrow('separate database')
  })
})
