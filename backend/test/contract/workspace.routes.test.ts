import Fastify from 'fastify'
import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { rabbitQueue } from '../../src/platform/rabbitmq'
import { workspaceRoutes } from '../../src/modules/workspace/workspace.routes'

function jobHistory() {
  return {
    findMany: vi.fn().mockImplementation(async (args: { distinct?: string[] }) => args.distinct ? [{ queue: 'atez-source-scan' }] : []),
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([{ status: 'COMPLETED', _count: { _all: 3 } }]),
  }
}

describe('persisted workspace routes', () => {
  it('partial updates retain disabled flags and other omitted user fields', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'u1', name: 'Changed', isActive: false })
    const app = Fastify(); await app.register(workspaceRoutes, { prisma: { user: { update } } as unknown as PrismaClient })
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/users/u1', payload: { name: 'Changed' } })
    expect(response.statusCode).toBe(200)
    expect(update).toHaveBeenCalledExactlyOnceWith({ where: { id: 'u1' }, data: { name: 'Changed' } })
    await app.close()
  })
  it('rejects incomplete academy attempts before saving', async () => {
    const transaction = vi.fn()
    const app = Fastify(); await app.register(workspaceRoutes, { prisma: { $transaction: transaction } as unknown as PrismaClient })
    const response = await app.inject({ method: 'POST', url: '/api/v1/academy/attempts', payload: { lessonId: 'daily', answers: [1] } })
    expect(response.statusCode).toBe(400); expect(transaction).not.toHaveBeenCalled()
    await app.close()
  })
  it('scores answers on the server and returns the previous best attempt when a repeat is worse', async () => {
    const tx = { $executeRaw: vi.fn(), academyAttempt: { findFirst: vi.fn().mockResolvedValue({ id: 'best', lessonId: 'daily', period: '2026-10-05', score: 100 }), create: vi.fn(), update: vi.fn() } }
    const app = Fastify(); await app.register(workspaceRoutes, { prisma: { $transaction: async (callback: (t: unknown) => unknown) => callback(tx) } as unknown as PrismaClient })
    const response = await app.inject({ method: 'POST', url: '/api/v1/academy/attempts', payload: { lessonId: 'daily', answers: [0, 1, 0], score: 10000 } })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ id: 'best', type: 'daily', correct: 3, total: 3, points: 30 })
    expect(tx.academyAttempt.create).not.toHaveBeenCalled(); expect(tx.academyAttempt.update).not.toHaveBeenCalled()
    await app.close()
  })
  it('serves real queue status on the monitor endpoint', async () => {
    const queues = [{ name: 'atez-source-scan', consumers: 1, waiting: 0, retrying: 0, failed: 0 }]
    vi.spyOn(rabbitQueue, 'status').mockResolvedValue(queues)
    const app = Fastify()
    await app.register(workspaceRoutes, { prisma: { backgroundJob: jobHistory() } as unknown as PrismaClient })
    const response = await app.inject({ method: 'GET', url: '/api/v1/background-jobs' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ connected: true, queues, jobs: [], total: 0, page: 1, types: ['atez-source-scan'], counts: { COMPLETED: 3 }, checkedAt: expect.any(String) })
    await app.close()
  })
  it('reports an unavailable monitor without exposing connection details', async () => {
    vi.spyOn(rabbitQueue, 'status').mockRejectedValue(new Error('Internal connection details'))
    const app = Fastify()
    await app.register(workspaceRoutes, { prisma: { backgroundJob: jobHistory() } as unknown as PrismaClient })
    // A broker outage still serves the persisted job history, flagged as disconnected.
    const brokerDown = await app.inject({ method: 'GET', url: '/api/v1/background-jobs' })
    expect(brokerDown.statusCode).toBe(200)
    expect(brokerDown.json()).toMatchObject({ connected: false, queues: [], jobs: [] })
    expect(brokerDown.body).not.toContain('Internal connection details')
    await app.close()
    // A history store outage is a 503 that still hides internal details.
    const failing = { ...jobHistory(), count: vi.fn().mockRejectedValue(new Error('Internal connection details')) }
    const broken = Fastify()
    await broken.register(workspaceRoutes, { prisma: { backgroundJob: failing } as unknown as PrismaClient })
    const response = await broken.inject({ method: 'GET', url: '/api/v1/background-jobs' })
    expect(response.statusCode).toBe(503)
    expect(response.body).not.toContain('Internal connection details')
    await broken.close()
  })

})

describe('corporate template protection',()=>{
  it('uses the fixed corporate shell and ignores attempts to restyle a known component',async()=>{
    const {sectionComponents,templateHtml}=await import('../../src/modules/workspace/report-template-catalog')
    const section=sectionComponents.find(s=>s.id==='summary')!
    const create=vi.fn().mockImplementation(async ({data})=>({id:'template-1',...data}))
    const app=Fastify();await app.register(workspaceRoutes,{prisma:{reportTemplate:{create}} as unknown as PrismaClient})
    const response=await app.inject({method:'POST',url:'/api/v1/templates',payload:{name:'İçerik şablonu',html:'<header>Farklı logo</header>{{sections}}',sections:[{...section,html:section.html.replace('class="block"','class="custom-style"').replace('Mevzuatın kısa özeti burada yer alır.','Düzenlenen metin.')}]}})
    expect(response.statusCode).toBe(201)
    expect(create.mock.calls[0]![0].data.html).toBe(templateHtml)
    expect(response.json().sections[0].html).toContain('Düzenlenen metin.')
    expect(response.json().sections[0].html).not.toContain('custom-style')
    await app.close()
  })
  it('rejects arbitrary component markup in newly created templates',async()=>{
    const create=vi.fn()
    const app=Fastify();await app.register(workspaceRoutes,{prisma:{reportTemplate:{create}} as unknown as PrismaClient})
    const response=await app.inject({method:'POST',url:'/api/v1/templates',payload:{name:'Şablon',html:'{{sections}}',sections:[{id:'unknown',heading:'Özel tasarım',html:'<p>Yeni tasarım</p>',enabled:true}]}})
    expect(response.statusCode).toBe(400)
    expect(create).not.toHaveBeenCalled()
    await app.close()
  })
})
