import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { scanRunsRoutes } from '../../src/modules/scan-runs/scan-runs.routes'
import { renderReportHtml } from '../../src/modules/topic-analysis/application/render-report-html'
import { ReportSpecSchema } from '../../src/modules/topic-analysis/domain/report-spec-schemas'
import type { PrismaScanRepository } from '../../src/modules/scan-runs/infrastructure/prisma-scan-repository'
import type { PrismaTopicAnalysisRepository } from '../../src/modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'
import type { AiModelClient } from '../../src/modules/ai/application/ai-model-client'

const spec = ReportSpecSchema.parse({
  schemaVersion: 1, templateFamily: 'bulten-v2', reportId: '210926-00', topicId: null, card: 'K6',
  documentTitle: 'ATEZ Mevzuat Radarı Günlük Raporu — Değişiklik Yok',
  issueNumber: '33377', displayDate: '21 Eylül 2026 Pazartesi',
  emptyDayText: 'İncelenen 18 resmî belgede raporlanabilir değişiklik bulunmadı.',
  source: { label: 'T.C. Resmî Gazete', url: 'https://www.resmigazete.gov.tr/' },
  blocks: ['B1', 'B10'],
})

describe('no-change report review', () => {
  it('serves the requested immutable HTML version and a downloadable PDF', async () => {
    const getRunReportHtmlKey = vi.fn(async (_runId: string, _reportId: string, version?: number) => version === 2 ? 'html-2' : null)
    const pdfRenderer = { renderHtml: vi.fn(async () => Buffer.from('%PDF-fixture')) }
    const app = Fastify()
    await app.register(scanRunsRoutes, {
      repository: {} as PrismaScanRepository,
      topicRepository: { getRunReportHtmlKey } as unknown as PrismaTopicAnalysisRepository,
      objectStore: { getContent: async () => Buffer.from('<html>r02</html>') }, pdfRenderer,
    })
    const html = await app.inject({ method: 'GET', url: '/run-1/reports/report-1/html?version=2' })
    const pdf = await app.inject({ method: 'GET', url: '/run-1/reports/report-1/pdf?version=2' })
    expect(html.statusCode).toBe(200)
    expect(html.body).toContain('r02')
    const downloadedHtml = await app.inject({ method: 'GET', url: '/run-1/reports/report-1/html?version=2&download=1' })
    expect(downloadedHtml.headers['content-disposition']).toContain('attachment')
    expect(pdf.statusCode).toBe(200)
    expect(pdf.headers['content-disposition']).toContain('attachment')
    expect(pdf.headers['content-type']).toContain('application/pdf')
    expect(getRunReportHtmlKey).toHaveBeenCalledWith('run-1', 'report-1', 2)
    expect((await app.inject({ method: 'GET', url: '/run-1/reports/report-1/pdf?version=1' })).statusCode).toBe(404)
    await app.close()
  })

  it('turns a report prompt into an uncommitted field edit without creating chat history', async () => {
    const saveNoChangeReviewDraft = vi.fn().mockResolvedValue(true)
    const model = { generateStructured: vi.fn().mockResolvedValue({
      json: { outcome: 'EDITS', requests: [{ summary: 'Bilgi metnini kısalt', outcome: 'EDITS' }], edits: [{ path: 'emptyDayText', value: 'İncelenen belgelerde ilgili değişiklik bulunmadı.', requestIndex: 0 }] },
      providerRequestId: 'model-1', usage: { inputTokens: 20, outputTokens: 10 },
    }) }
    const app = Fastify()
    await app.register(scanRunsRoutes, {
      repository: {} as PrismaScanRepository,
      topicRepository: { getNoChangeReport: async () => ({
        id: 'report-1', title: spec.documentTitle, basename: '00-degisiklik-yok.html', version: 1,
        specObjectKey: 'spec-1', htmlObjectKey: 'html-1', targetDate: '2026-09-21',
        reviewStatus: 'READY', pendingSpecJson: null, pendingBaseVersion: null,
      }), saveNoChangeReviewDraft } as unknown as PrismaTopicAnalysisRepository,
      objectStore: { getContent: async () => Buffer.from(JSON.stringify(spec)) },
      reportPatchModel: model as unknown as AiModelClient,
      reportPatchModelName: 'gemini-test',
    })
    const response = await app.inject({ method: 'POST', url: '/run-1/reports/report-1/review/prompt', payload: {
      expectedVersion: 1, message: 'Bilgi metnini kısalt',
    } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ version: 1, edits: [{ path: 'emptyDayText', value: 'İncelenen belgelerde ilgili değişiklik bulunmadı.' }] })
    expect(response.json().html).toContain('İncelenen belgelerde ilgili değişiklik bulunmadı.')
    expect(saveNoChangeReviewDraft).toHaveBeenCalledWith('run-1', 'report-1', 1, expect.objectContaining({ emptyDayText: 'İncelenen belgelerde ilgili değişiklik bulunmadı.' }))
    expect(model.generateStructured).toHaveBeenCalledOnce()
    await app.close()
  })

  it('opens the existing HTML and publishes a validated field edit as the next revision', async () => {
    const files = new Map<string, Buffer>()
    files.set('spec-1', Buffer.from(JSON.stringify(spec)))
    files.set('html-1', Buffer.from(await renderReportHtml(spec)))
    let version = 1
    let specObjectKey = 'spec-1'
    let htmlObjectKey = 'html-1'
    let pendingSpec: typeof spec | null = null
    const topicRepository = {
      getNoChangeReport: vi.fn(async () => ({
        id: 'report-1', title: spec.documentTitle, basename: '00-degisiklik-yok.html',
        version, specObjectKey, htmlObjectKey, targetDate: '2026-09-21',
        reviewStatus: pendingSpec ? 'PENDING_APPROVAL' : 'READY', pendingSpecJson: pendingSpec,
        pendingBaseVersion: pendingSpec ? version : null,
      })),
      saveNoChangeReviewDraft: vi.fn(async (_runId: string, _reportId: string, _version: number, value: typeof spec) => { pendingSpec = value; return true }),
      discardNoChangeReviewDraft: vi.fn(async () => { pendingSpec = null; return true }),
      publishNoChangeReviewDraft: vi.fn(async (input: { expectedVersion: number; specObjectKey: string; htmlObjectKey: string }) => {
        version = input.expectedVersion + 1
        specObjectKey = input.specObjectKey
        htmlObjectKey = input.htmlObjectKey
        pendingSpec = null
        return true
      }),
    }
    const objectStore = {
      getContent: async (key: string) => {
        const value = files.get(key)
        if (!value) throw new Error('Object missing')
        return value
      },
      putRunFile: async (key: string, body: Buffer, mediaType: string) => {
        files.set(key, body)
        return { objectKey: key, sha256: 'a'.repeat(64), mediaType, byteSize: BigInt(body.length) }
      },
    }
    const app = Fastify()
    await app.register(scanRunsRoutes, {
      repository: {} as PrismaScanRepository,
      topicRepository: topicRepository as unknown as PrismaTopicAnalysisRepository,
      objectStore,
    })

    const url = '/run-1/reports/report-1/review'
    const opened = await app.inject({ method: 'GET', url })
    expect(opened.statusCode).toBe(200)
    expect(opened.json()).toMatchObject({ version: 1, reviewStatus: 'READY', draft: null, spec: { emptyDayText: 'İncelenen 18 resmî belgede raporlanabilir değişiklik bulunmadı.' } })

    const draft = await app.inject({ method: 'PUT', url: `${url}/draft`, payload: {
      expectedVersion: 1, edits: [{ path: 'emptyDayText', value: 'Yeni ve doğrulanmış bilgi metni.' }],
    } })
    expect(draft.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url })).json()).toMatchObject({ version: 1, reviewStatus: 'PENDING_APPROVAL', draft: { spec: { emptyDayText: 'Yeni ve doğrulanmış bilgi metni.' } } })

    const saved = await app.inject({ method: 'POST', url, payload: {
      expectedVersion: 1, edits: [{ path: 'emptyDayText', value: 'Yeni ve doğrulanmış bilgi metni.' }],
    } })
    expect(saved.statusCode).toBe(201)
    expect(saved.json()).toMatchObject({ version: 2, spec: { emptyDayText: 'Yeni ve doğrulanmış bilgi metni.' } })
    expect(saved.json().html).toContain('Yeni ve doğrulanmış bilgi metni.')
    expect(topicRepository.publishNoChangeReviewDraft).toHaveBeenCalledWith(expect.objectContaining({ reportId: 'report-1', expectedVersion: 1 }))

    const locked = await app.inject({ method: 'PUT', url: `${url}/draft`, payload: {
      expectedVersion: 2, edits: [{ path: 'documentTitle', value: 'Farklı rapor' }],
    } })
    expect(locked.statusCode).toBe(400)

    const stale = await app.inject({ method: 'POST', url, payload: {
      expectedVersion: 1, edits: [{ path: 'emptyDayText', value: 'Eski düzenleme.' }],
    } })
    expect(stale.statusCode).toBe(409)
    expect(topicRepository.publishNoChangeReviewDraft).toHaveBeenCalledTimes(1)

    const secondDraft = await app.inject({ method: 'PUT', url: `${url}/draft`, payload: {
      expectedVersion: 2, edits: [{ path: 'emptyDayText', value: 'İkinci taslak metni.' }],
    } })
    expect(secondDraft.statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: `${url}/draft` })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url })).json()).toMatchObject({ version: 2, reviewStatus: 'READY', draft: null })
    await app.close()
  })
})
