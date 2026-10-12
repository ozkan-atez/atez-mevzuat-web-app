import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { sourceScanRunRoutes } from '../../src/modules/managed-sources/source-scan-runs.routes'
const id = 'bbe478d7-ea92-4c6a-8881-4f34142be5bb'
const document = { id: 'doc', title: 'Mevzuat', url: 'https://ticaret.gov.tr/duyuru', publishedOn: new Date('2026-10-08'), feedUrl: '', contentText: 'Metin', filterDecision: null, filterReason: null, processingStatus: 'PENDING', processingError: null, topicId: null, reportVersion: null }
async function appFor(run: unknown) {
  const prisma: any = { sourceScanRun: { findUnique: vi.fn().mockResolvedValue(run), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, sourceScanDocument: { findMany: vi.fn().mockResolvedValue([]) } }
  prisma.$transaction = async (fn: (tx: unknown) => unknown) => fn(prisma)
  const app = Fastify()
  await app.register(sourceScanRunRoutes, { prefix: '/api/v1/source-scan-runs', prisma: prisma as unknown as PrismaClient })
  return { app, prisma }
}
describe('external source report API', () => {
  it('keeps old unfiltered HTML out of ready reports and allows legacy AI evaluation', async () => {
    const { app } = await appFor({ id, status: 'COMPLETED', documents: [document], reportHtml: '<h1>Old excerpt</h1>' })
    try {
      const detail = (await app.inject(`/api/v1/source-scan-runs/${id}`)).json()
      expect(detail.counters).toEqual({ found: 1, relevant: 0, excluded: 0, failed: 0, readyReports: 0 })
      expect(detail.canAnalyze).toBe(true); expect(detail.hasReport).toBe(false)
      expect((await app.inject(`/api/v1/source-scan-runs/${id}/report`)).statusCode).toBe(404)
    } finally { await app.close() }
  })
  it('counts only completed included documents with persisted report identities', async () => {
    const { app } = await appFor({ id, status: 'PARTIAL', documents: [
      { ...document, filterDecision: 'IN', processingStatus: 'COMPLETED', topicId: id, reportVersion: 1 },
      { ...document, filterDecision: 'OUT', processingStatus: 'EXCLUDED' },
      { ...document, filterDecision: 'IN', processingStatus: 'FAILED', processingError: 'AI error' },
    ] })
    try {
      const detail = (await app.inject(`/api/v1/source-scan-runs/${id}`)).json()
      expect(detail.counters).toEqual({ found: 3, relevant: 2, excluded: 1, failed: 1, readyReports: 1 })
      expect(detail.hasReport).toBe(true)
    } finally { await app.close() }
  })
  it('atomically queues legacy evaluation while rejecting a concurrent repeat', async () => {
    const { app, prisma } = await appFor(null)
    try {
      expect((await app.inject({ method: 'POST', url: `/api/v1/source-scan-runs/${id}/analyze` })).statusCode).toBe(202)
      expect(prisma.sourceScanRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id, OR: expect.any(Array) }), data: expect.objectContaining({ status: 'QUEUED', queueVersion: { increment: 1 }, reportHtml: null }) }))
      prisma.sourceScanRun.updateMany.mockResolvedValue({ count: 0 })
      expect((await app.inject({ method: 'POST', url: `/api/v1/source-scan-runs/${id}/analyze` })).statusCode).toBe(409)
    } finally { await app.close() }
  })
  it('serves archived bytes from the requested document and never follows caller-supplied URLs',async()=>{
    const documentId='8f017761-c2d3-4b41-b52c-a4cbf377e60b'
    const bytes=Buffer.from('%PDF-original-file')
    const findFirst=vi.fn().mockResolvedValue({capturedFiles:[{url:'https://ticaret.gov.tr/Mevzuat%20eki.pdf',status:'STORED',objectKey:'source-captures/hash',mediaType:'application/pdf'}]})
    const getContent=vi.fn().mockResolvedValue(bytes)
    const app=Fastify();await app.register(sourceScanRunRoutes,{prefix:'/api/v1/source-scan-runs',prisma:{sourceScanDocument:{findFirst}} as unknown as PrismaClient,objectStore:{getContent}})
    try{
      const result=await app.inject(`/api/v1/source-scan-runs/${id}/documents/${documentId}/files/0`)
      expect(result.statusCode).toBe(200);expect(result.rawPayload).toEqual(bytes)
      expect(result.headers['content-disposition']).toContain('Mevzuat%20eki.pdf')
      expect(findFirst).toHaveBeenCalledWith({where:{id:documentId,runId:id},select:{capturedFiles:true}})
      expect(getContent).toHaveBeenCalledExactlyOnceWith('source-captures/hash')
      expect((await app.inject(`/api/v1/source-scan-runs/${id}/documents/${documentId}/files/1`)).statusCode).toBe(404)
    }finally{await app.close()}
  })

})
