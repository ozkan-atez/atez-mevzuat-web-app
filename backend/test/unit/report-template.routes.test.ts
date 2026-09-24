import Fastify from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { reportTemplateRoutes } from '../../src/modules/report-templates/report-template.routes'
import { buildPresetHtml, insertTemplateComponent } from '../../src/modules/report-templates/template-composer'

describe('report template routes', () => {
  it('offers reusable components and returns an unsaved AI revision', async () => {
    const create = vi.fn()
    const model = { generateStructured: vi.fn(async () => ({ json: { name: 'Yönetici raporu', description: '', html: '<html><body><h1>Yeni görünüm</h1></body></html>', summary: 'Başlık yenilendi.' }, providerRequestId: null, usage: { inputTokens: null, outputTokens: null } })) }
    const app = Fastify()
    await app.register(reportTemplateRoutes, { prisma: { reportTemplate: { create } } as unknown as PrismaClient, model, modelName: 'test-model' })
    const catalog = (await app.inject({ method: 'GET', url: '/catalog' })).json()
    expect(catalog.components.length).toBeGreaterThanOrEqual(8)
    const html = buildPresetHtml('executive')
    expect(insertTemplateComponent(html, 'table')).toContain('Karşılaştırma tablosu')
    const response = await app.inject({ method: 'POST', url: '/suggest', payload: { message: 'Başlığı yenile', name: 'Eski', description: null, html } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ name: 'Yönetici raporu', summary: 'Başlık yenilendi.' })
    expect(create).not.toHaveBeenCalled()
    const unsafe = await app.inject({ method: 'POST', url: '/', payload: { name: 'X', description: null, html: '<html><body><script>alert(1)</script></body></html>' } })
    expect(unsafe.statusCode).toBe(400)
    await app.close()
  })
  it('creates drafts and rejects stale edits without changing the saved template', async () => {
    let template: { id: string; name: string; description: string | null; html: string; revision: number } | null = null
    const prisma = { reportTemplate: {
      findMany: vi.fn(async () => template ? [template] : []),
      findUnique: vi.fn(async () => template),
      findUniqueOrThrow: vi.fn(async () => template),
      create: vi.fn(async ({ data }: { data: { name: string; description: string | null; html: string } }) => {
        template = { id: 'template-1', ...data, revision: 1 }
        return template
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { revision: number }; data: { name: string; description: string | null; html: string } }) => {
        if (!template || template.revision !== where.revision) return { count: 0 }
        template = { ...template, ...data, revision: template.revision + 1 }
        return { count: 1 }
      }),
    } } as unknown as PrismaClient
    const app = Fastify()
    await app.register(reportTemplateRoutes, { prisma })

    const invalid = await app.inject({ method: 'POST', url: '/', payload: { name: '', html: '' } })
    expect(invalid.statusCode).toBe(400)

    const created = await app.inject({ method: 'POST', url: '/', payload: { name: ' Yönetici ', description: null, html: '<html><body>İlk</body></html>' } })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ name: 'Yönetici', revision: 1 })
    expect((await app.inject({ method: 'GET', url: '/' })).json().templates).toHaveLength(1)

    const updated = await app.inject({ method: 'PUT', url: '/template-1', payload: { name: 'Yönetici', description: null, html: '<html><body>Yeni</body></html>', revision: 1 } })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({ revision: 2, html: '<html><body>Yeni</body></html>' })

    const stale = await app.inject({ method: 'PUT', url: '/template-1', payload: { name: 'Yönetici', description: null, html: '<html><body>Eski</body></html>', revision: 1 } })
    expect(stale.statusCode).toBe(409)
    expect((await app.inject({ method: 'GET', url: '/template-1' })).json().html).toBe('<html><body>Yeni</body></html>')
    await app.close()
  })
})
