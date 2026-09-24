import type { FastifyInstance } from 'fastify'
import { DateTime } from 'luxon'
import { buildScheduleView } from './application/build-schedule-view'
import { AiFilterRetryConflictError, PreviousSourceRetryConflictError, RunRetryConflictError, type PrismaScanRepository } from './infrastructure/prisma-scan-repository'
import { createScanRunSchema, idempotencyKeySchema } from './scan-runs.schemas'
import type { PrismaTopicAnalysisRepository } from '../topic-analysis/infrastructure/prisma-topic-analysis-repository'
import type { TopicObjectStore } from '../topic-analysis/application/ports'
import { ReportSpecSchema } from '../topic-analysis/domain/report-spec-schemas'
import { applyReportPatch, ReportPatchError } from '../topic-analysis/domain/report-patch'
import { applyEditsSchema } from '../topic-analysis/topic-analysis.schemas'
import { renderReportHtml } from '../topic-analysis/application/render-report-html'
import { validateReportHtml } from '../topic-analysis/application/validate-report-html'
import { PatchResponseSchema, buildPatchPromptParts, buildPatchSystemInstruction, patchResponseJsonSchema } from '../topic-analysis/application/patch-prompts'
import type { AiModelClient } from '../ai/application/ai-model-client'
import { z } from 'zod'
import type { PdfRenderer } from '../delivery/application/ports'

interface Options {
  repository: PrismaScanRepository
  topicRepository?: PrismaTopicAnalysisRepository
  objectStore?: Pick<TopicObjectStore, 'getContent'> & Partial<Pick<TopicObjectStore, 'putRunFile'>>
  reportPatchModel?: AiModelClient
  reportPatchModelName?: string
  pdfRenderer?: PdfRenderer
  timezone?: string
}

const terminalStatuses = new Set(['AWAITING_RETRY', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'])
const reportPromptSchema = z.object({
  expectedVersion: z.number().int().positive(),
  message: z.string().trim().min(1).max(8_000),
}).strict()
const reviewDraftSchema = z.object({
  expectedVersion: z.number().int().positive(),
  edits: z.array(z.object({ path: z.literal('emptyDayText'), value: z.string().trim().min(1).max(8_000) }).strict()).length(1),
}).strict()

export async function scanRunsRoutes(app: FastifyInstance, options: Options) {
  app.post('/:id/reports/:reportId/review/prompt', async (request, reply) => {
    const { id, reportId } = request.params as { id: string; reportId: string }
    if (!options.topicRepository || !options.objectStore || !options.reportPatchModel || !options.reportPatchModelName) {
      return reply.code(503).send({ message: 'Rapor revizyon asistanı kullanılamıyor' })
    }
    const body = reportPromptSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ message: 'Geçerli bir revizyon talebi gereklidir' })
    const report = await options.topicRepository.getNoChangeReport(id, reportId)
    if (!report) return reply.code(404).send({ message: 'Rapor bulunamadı' })
    if (report.version !== body.data.expectedVersion) return reply.code(409).send({ message: 'Rapor güncellendi. Sayfayı yenileyip tekrar deneyin.', currentVersion: report.version })
    if (report.reviewStatus === 'PENDING_APPROVAL' && report.pendingBaseVersion !== report.version) return reply.code(409).send({ message: 'Bekleyen revizyon eski sürüme ait. Sayfayı yenileyin.' })
    const saved = ReportSpecSchema.parse(JSON.parse((await options.objectStore.getContent(report.specObjectKey)).toString('utf8')))
    if (saved.card !== 'K6') return reply.code(400).send({ message: 'Bu revizyon asistanı yalnızca değişiklik yok raporu içindir' })
    const current = report.reviewStatus === 'PENDING_APPROVAL' && report.pendingSpecJson
      ? ReportSpecSchema.parse(report.pendingSpecJson) : saved
    if (current.card !== 'K6') return reply.code(400).send({ message: 'Rapor türü değiştirilemez' })
    let parsed: ReturnType<typeof PatchResponseSchema.parse>
    try {
      const result = await options.reportPatchModel.generateStructured({
        model: options.reportPatchModelName,
        systemInstruction: buildPatchSystemInstruction(),
        parts: buildPatchPromptParts({ spec: current, request: body.data.message }),
        responseJsonSchema: patchResponseJsonSchema,
      })
      parsed = PatchResponseSchema.parse(result.json)
    } catch (error) {
      request.log.error({ err: error }, 'Rapor revizyon talebi tamamlanamadı')
      return reply.code(502).send({ message: 'Revizyon isteği işlenemedi. Lütfen yeniden deneyin.' })
    }
    const suggested = (parsed.edits ?? []).filter((edit) => edit.path === 'emptyDayText' && !edit.clear)
    if (suggested.length === 0) return reply.code(422).send({ message: parsed.reason ?? 'Bu raporda değiştirilebilir bir metin bulunamadı.' })
    const value = suggested.at(-1)!.value
    let updated: ReturnType<typeof ReportSpecSchema.parse>
    try {
      updated = applyReportPatch(current, { edits: [{ path: 'emptyDayText', value }] }).spec
    } catch (error) {
      if (error instanceof ReportPatchError) return reply.code(422).send({ message: error.message })
      throw error
    }
    if (updated.card !== 'K6') return reply.code(400).send({ message: 'Rapor türü değiştirilemez' })
    if (updated.emptyDayText === current.emptyDayText) return reply.code(422).send({ message: 'Revizyon talebi raporda bir değişiklik oluşturmadı.' })
    const html = await renderReportHtml(updated)
    validateReportHtml(html, { card: 'K6', topicId: null, basename: report.basename })
    if (!await options.topicRepository.saveNoChangeReviewDraft(id, reportId, report.version, updated)) {
      return reply.code(409).send({ message: 'Rapor güncellendi. Sayfayı yenileyip tekrar deneyin.' })
    }
    return reply.send({ version: report.version, reviewStatus: 'PENDING_APPROVAL', edits: [{ path: 'emptyDayText', value }], html })
  })

  app.get('/:id/reports/:reportId/review', async (request, reply) => {
    const { id, reportId } = request.params as { id: string; reportId: string }
    if (!options.topicRepository || !options.objectStore) return reply.code(503).send({ message: 'Rapor servisi kullanılamıyor' })
    const report = await options.topicRepository.getNoChangeReport(id, reportId)
    if (!report) return reply.code(404).send({ message: 'Rapor bulunamadı' })
    const [spec, html] = await Promise.all([
      options.objectStore.getContent(report.specObjectKey),
      options.objectStore.getContent(report.htmlObjectKey),
    ])
    const publishedSpec = ReportSpecSchema.parse(JSON.parse(spec.toString('utf8')))
    const draftSpec = report.reviewStatus === 'PENDING_APPROVAL' && report.pendingSpecJson
      ? ReportSpecSchema.parse(report.pendingSpecJson) : null
    const draftHtml = draftSpec ? await renderReportHtml(draftSpec) : null
    return reply.send({
      title: report.title, version: report.version, spec: publishedSpec, html: html.toString('utf8'),
      reviewStatus: report.reviewStatus,
      draft: draftSpec && draftSpec.card === 'K6' ? { baseVersion: report.pendingBaseVersion, spec: draftSpec, html: draftHtml } : null,
    })
  })

  app.put('/:id/reports/:reportId/review/draft', async (request, reply) => {
    const { id, reportId } = request.params as { id: string; reportId: string }
    if (!options.topicRepository || !options.objectStore) return reply.code(503).send({ message: 'Rapor düzenleme servisi kullanılamıyor' })
    const body = reviewDraftSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ message: 'Geçerli bir rapor değişikliği gereklidir' })
    const report = await options.topicRepository.getNoChangeReport(id, reportId)
    if (!report) return reply.code(404).send({ message: 'Rapor bulunamadı' })
    if (report.version !== body.data.expectedVersion) return reply.code(409).send({ message: 'Rapor güncellendi. Sayfayı yenileyip tekrar deneyin.' })
    const original = ReportSpecSchema.parse(JSON.parse((await options.objectStore.getContent(report.specObjectKey)).toString('utf8')))
    if (original.card !== 'K6') return reply.code(400).send({ message: 'Bu düzenleyici yalnızca değişiklik yok raporu içindir' })
    const changed = applyReportPatch(original, { edits: body.data.edits }).spec
    if (changed.card !== 'K6') return reply.code(400).send({ message: 'Rapor türü değiştirilemez' })
    if (changed.emptyDayText === original.emptyDayText) return reply.code(400).send({ message: 'Rapor metni değişmedi' })
    const html = await renderReportHtml(changed)
    validateReportHtml(html, { card: 'K6', topicId: null, basename: report.basename })
    if (!await options.topicRepository.saveNoChangeReviewDraft(id, reportId, report.version, changed)) return reply.code(409).send({ message: 'Rapor güncellendi. Sayfayı yenileyip tekrar deneyin.' })
    return reply.send({ version: report.version, reviewStatus: 'PENDING_APPROVAL', draft: { baseVersion: report.version, spec: changed, html } })
  })

  app.delete('/:id/reports/:reportId/review/draft', async (request, reply) => {
    const { id, reportId } = request.params as { id: string; reportId: string }
    if (!options.topicRepository) return reply.code(503).send({ message: 'Rapor düzenleme servisi kullanılamıyor' })
    return await options.topicRepository.discardNoChangeReviewDraft(id, reportId)
      ? reply.code(204).send()
      : reply.code(404).send({ message: 'Bekleyen revizyon bulunamadı' })
  })

  app.post('/:id/reports/:reportId/review', async (request, reply) => {
    const { id, reportId } = request.params as { id: string; reportId: string }
    const writer = options.objectStore?.putRunFile ? options.objectStore as TopicObjectStore : null
    if (!options.topicRepository || !writer) return reply.code(503).send({ message: 'Rapor düzenleme servisi kullanılamıyor' })
    const body = applyEditsSchema.safeParse(request.body)
    if (!body.success || body.data.expectedVersion === undefined) return reply.code(400).send({ message: 'Geçerli düzenleme ve rapor sürümü gereklidir' })
    const report = await options.topicRepository.getNoChangeReport(id, reportId)
    if (!report) return reply.code(404).send({ message: 'Rapor bulunamadı' })
    if (report.version !== body.data.expectedVersion) return reply.code(409).send({ message: 'Rapor güncellendi. Sayfayı yenileyip tekrar deneyin.', currentVersion: report.version })
    if (report.reviewStatus !== 'PENDING_APPROVAL' || report.pendingBaseVersion !== report.version || !report.pendingSpecJson) {
      return reply.code(409).send({ message: 'Onay bekleyen revizyon bulunamadı' })
    }
    const raw = await writer.getContent(report.specObjectKey)
    const original = ReportSpecSchema.parse(JSON.parse(raw.toString('utf8')))
    if (original.card !== 'K6') return reply.code(400).send({ message: 'Bu düzenleyici yalnızca değişiklik yok raporu içindir' })
    let spec: typeof original
    let applied: ReturnType<typeof applyReportPatch>['applied']
    try {
      const result = applyReportPatch(original, { edits: body.data.edits })
      if (result.spec.card !== 'K6') throw new Error('Rapor türü değiştirilemez')
      spec = result.spec
      applied = result.applied
    } catch (error) {
      if (error instanceof ReportPatchError) return reply.code(400).send({ message: error.message })
      throw error
    }
    if (applied.length === 0) return reply.send({ title: report.title, version: report.version, spec: original, html: (await writer.getContent(report.htmlObjectKey)).toString('utf8') })
    const pendingSpec = ReportSpecSchema.parse(report.pendingSpecJson)
    if (pendingSpec.card !== 'K6' || pendingSpec.emptyDayText !== spec.emptyDayText) return reply.code(409).send({ message: 'Bekleyen revizyon değişti. Sayfayı yenileyip tekrar deneyin.' })
    const version = report.version + 1
    // Keep concurrent attempts in separate object keys. The unique DB revision
    // decides which attempt wins without either writer overwriting its HTML.
    const root = `runs/${report.targetDate.replaceAll('-', '/')}/${id}/reports/r${String(version).padStart(2, '0')}/${crypto.randomUUID()}`
    const specObjectKey = `${root}/report-spec.json`
    const htmlObjectKey = `${root}/${report.basename}`
    const html = await renderReportHtml(spec)
    validateReportHtml(html, { card: 'K6', topicId: null, basename: report.basename })
    await writer.putRunFile(specObjectKey, Buffer.from(JSON.stringify(spec)), 'application/json')
    await writer.putRunFile(htmlObjectKey, Buffer.from(html), 'text/html; charset=utf-8')
    try {
      if (!await options.topicRepository.publishNoChangeReviewDraft({
        runId: id, reportId, expectedVersion: report.version, expectedUpdatedAt: report.updatedAt, title: spec.documentTitle,
        basename: report.basename, specObjectKey, htmlObjectKey,
      })) return reply.code(409).send({ message: 'Bekleyen revizyon değişti. Sayfayı yenileyip tekrar deneyin.' })
    } catch (error) {
      // Another editor may have published this version after our initial read.
      const current = await options.topicRepository.getNoChangeReport(id, reportId)
      if (current && current.version >= version) return reply.code(409).send({ message: 'Rapor güncellendi. Sayfayı yenileyip tekrar deneyin.', currentVersion: current.version })
      throw error
    }
    return reply.code(201).send({ title: report.title, version, spec, html, reviewStatus: 'READY', draft: null })
  })

  app.get('/:id/reports/:reportId/html', async (request, reply) => {
    const { id, reportId } = request.params as { id: string; reportId: string }
    const query = request.query as { version?: string; download?: string }
    const version = query.version ? Number(query.version) : undefined
    if (version !== undefined && (!Number.isInteger(version) || version < 1)) return reply.code(400).send({ message: 'Geçerli rapor sürümü gereklidir' })
    if (!options.topicRepository) return reply.code(503).send({ message: 'Rapor servisi kullanılamıyor' })
    const objectKey = await options.topicRepository.getRunReportHtmlKey(id, reportId, version)
    if (!objectKey) return reply.code(404).send({ message: 'Rapor bulunamadı' })
    if (!options.objectStore) return reply.code(503).send({ message: 'Rapor deposu kullanılamıyor' })
    if (query.download === '1') reply.header('Content-Disposition', `attachment; filename="mevzuat-raporu-r${version ?? 'son'}.html"`)
    return reply.type('text/html; charset=utf-8').send(await options.objectStore.getContent(objectKey))
  })

  app.get('/:id/reports/:reportId/pdf', async (request, reply) => {
    const { id, reportId } = request.params as { id: string; reportId: string }
    const query = request.query as { version?: string }
    const version = query.version ? Number(query.version) : undefined
    if (version !== undefined && (!Number.isInteger(version) || version < 1)) return reply.code(400).send({ message: 'Geçerli rapor sürümü gereklidir' })
    if (!options.topicRepository || !options.objectStore || !options.pdfRenderer) return reply.code(503).send({ message: 'PDF servisi kullanılamıyor' })
    const objectKey = await options.topicRepository.getRunReportHtmlKey(id, reportId, version)
    if (!objectKey) return reply.code(404).send({ message: 'Rapor bulunamadı' })
    const html = (await options.objectStore.getContent(objectKey)).toString('utf8')
    const pdf = await options.pdfRenderer.renderHtml(html)
    return reply.type('application/pdf').header('Content-Disposition', 'attachment; filename="mevzuat-raporu.pdf"').send(pdf)
  })

  app.get('/:id/topics', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!options.topicRepository) return reply.code(503).send({ message: 'Topic servisi kullanılamıyor' })
    const run = await options.repository.getExecutionRun(id)
    if (!run) return reply.code(404).send({ message: 'Tarama bulunamadı' })
    return reply.send({ topics: await options.topicRepository.listRunTopicDetails(id) })
  })

  app.get('/schedule', async (request) => {
    const query = request.query as { date?: string }
    const now = DateTime.now().setZone(options.timezone ?? 'Europe/Istanbul')
    const requested = query.date && DateTime.fromFormat(query.date, 'yyyy-MM-dd', { zone: options.timezone ?? 'Europe/Istanbul' }).isValid
      ? query.date
      : now.toFormat('yyyy-MM-dd')
    return buildScheduleView({
      targetDate: requested,
      // "Due" only means overdue for today; a past day's unrun slots are all overdue.
      localHour: requested === now.toFormat('yyyy-MM-dd') ? now.hour : 24,
      runs: await options.repository.listScheduledRunsForDate(requested),
    })
  })

  app.get('/', async (request) => {
    const query = request.query as { limit?: string }
    const parsedLimit = Number(query.limit ?? 10)
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 50) : 10
    return { runs: await options.repository.listRuns(limit) }
  })

  app.post('/', async (request, reply) => {
    const keyResult = idempotencyKeySchema.safeParse(request.headers['idempotency-key'])
    const bodyResult = createScanRunSchema.safeParse(request.body)
    if (!keyResult.success || !bodyResult.success) {
      return reply.code(400).send({ message: 'Geçerli Idempotency-Key ve YYYY-MM-DD tarihi gereklidir' })
    }
    const sourceKeys = bodyResult.data.sourceKeys ?? ['resmi-gazete']
    if (sourceKeys.some((key) => key !== 'resmi-gazete')) {
      const available = await options.repository.listRunnableSourceKeys()
      if (sourceKeys.some((key) => !available.includes(key))) return reply.code(422).send({ message: 'Seçilen kaynaklardan biri taramaya hazır değil.' })
    }
    const run = await options.repository.createManualRun({ requestKey: keyResult.data, targetDate: bodyResult.data.targetDate, sourceKeys })
    return reply.code(202).send({ runId: run.id, status: run.status, targetDate: run.targetDate })
  })

  app.post('/:id/retry', async (request, reply) => {
    const key = idempotencyKeySchema.safeParse(request.headers['idempotency-key'])
    if (!key.success) return reply.code(400).send({ message: 'Geçerli Idempotency-Key gereklidir' })
    const { id } = request.params as { id: string }
    try {
      return reply.code(202).send(await options.repository.requestRunRetry(id, key.data))
    } catch (error) {
      if (error instanceof RunRetryConflictError) return reply.code(409).send({ message: 'Tarama yeniden denenmeye hazır değil' })
      throw error
    }
  })

  app.post('/:id/ai-filter/retry', async (request, reply) => {
    const keyResult = idempotencyKeySchema.safeParse(request.headers['idempotency-key'])
    if (!keyResult.success) return reply.code(400).send({ message: 'Geçerli Idempotency-Key gereklidir' })
    const { id } = request.params as { id: string }
    try {
      return reply.code(202).send(await options.repository.requestAiFilterRetry(id, keyResult.data))
    } catch (error) {
      if (error instanceof AiFilterRetryConflictError) return reply.code(409).send({ message: 'AI filtresi yeniden denenmeye hazır değil' })
      throw error
    }
  })

  app.post('/:id/previous-sources/retry', async (request, reply) => {
    const keyResult = idempotencyKeySchema.safeParse(request.headers['idempotency-key'])
    if (!keyResult.success) return reply.code(400).send({ message: 'Geçerli Idempotency-Key gereklidir' })
    const { id } = request.params as { id: string }
    try {
      return reply.code(202).send(await options.repository.requestPreviousSourceRetry(id, keyResult.data))
    } catch (error) {
      if (error instanceof PreviousSourceRetryConflictError) return reply.code(409).send({ message: 'Önceki kaynak işlemi yeniden denenmeye hazır değil' })
      throw error
    }
  })

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const run = await options.repository.getRun(id)
    if (!run) return reply.code(404).send({ message: 'Tarama bulunamadı' })
    return reply.send(run)
  })

  app.get('/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string }
    const initial = await options.repository.getRun(id)
    if (!initial) return reply.code(404).send({ message: 'Tarama bulunamadı' })

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    })
    let lastPayload = ''
    const send = async () => {
      const run = await options.repository.getRun(id)
      if (!run) return
      const payload = JSON.stringify(run)
      if (payload !== lastPayload) {
        reply.raw.write(`event: scan.snapshot\ndata: ${payload}\n\n`)
        lastPayload = payload
      }
      if (terminalStatuses.has(run.status)) close()
    }
    const timer = setInterval(() => void send(), 1_000)
    const close = () => {
      clearInterval(timer)
      if (!reply.raw.writableEnded) reply.raw.end()
    }
    request.raw.once('close', close)
    await send()
  })
}
