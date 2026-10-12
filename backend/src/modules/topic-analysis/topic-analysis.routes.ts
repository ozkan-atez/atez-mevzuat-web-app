import type { AiModelClient } from '../ai/application/ai-model-client'
import { reviseRunReport } from './application/revise-run-report'
import { applyAutomationTemplate } from './application/apply-automation-template'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ReportCustomizationSchema, ReportSourceSchema } from './domain/report-spec-schemas'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { idempotencyKeySchema } from '../scan-runs/scan-runs.schemas'
import type { ReportDraftRepository, TopicObjectStore } from './application/ports'
import { classifyRevisionKind } from './application/build-revision-context'
import {
  PrismaTopicAnalysisRepository,
  TopicCommandConflictError,
  TopicNotFoundError,
  TopicRetryConflictError,
} from './infrastructure/prisma-topic-analysis-repository'
import {
  ReportDraftConflictError,
  ReportDraftBusyError,
  ReportDraftChangedError,
  ReportNotPublishedError,
  applyReportFieldEdits,
  getReportDraftView,
  revertReportFieldEdit,
  type ReportDraftView,
} from './application/apply-report-field-edits'
import { discardReportDraft, publishReportDraft } from './application/publish-report-draft'
import { ReportPatchError } from './domain/report-patch'
import { applyEditsSchema, messageSchema, publishDraftSchema, versionSchema } from './topic-analysis.schemas'

interface Options {
  revisionModel?: AiModelClient
  revisionModelName?: string
  repository: PrismaTopicAnalysisRepository
  /** Publishing a draft also writes, so the full store is needed once drafts are enabled. */
  objectStore?: Pick<TopicObjectStore, 'getContent'> & Partial<Pick<TopicObjectStore, 'putRunFile'>>
  loadDocumentVersion?: (id: string) => Promise<{ id: string; title: string; url: string | null; text: string | null; filename: string | null; visibility?: string } | null>
  loadTemplate?: (id: string) => Promise<unknown | null>
  draftRepository?: ReportDraftRepository
}

export async function topicAnalysisRoutes(app: FastifyInstance, options: Options) {
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const topic = await options.repository.getTopicDetail(id)
    if (!topic) return reply.code(404).send({ message: 'Topic bulunamadı' })
    return reply.send(topic)
  })

  app.get('/:id/messages', async (request, reply) => {
    const { id } = request.params as { id: string }
    const topic = await options.repository.getTopicDetail(id)
    if (!topic) return reply.code(404).send({ message: 'Topic bulunamadı' })
    return reply.send({ topicId: id, messages: topic.thread.messages })
  })

  app.get('/:id/reports/:revision/html', async (request, reply) => {
    const { id, revision } = request.params as { id: string; revision: string }
    const parsed = versionSchema.safeParse(revision)
    if (!parsed.success) return reply.code(400).send({ message: 'Geçerli rapor revizyonu gereklidir' })
    const objectKey = await options.repository.getTopicReportHtmlKey(id, parsed.data)
    if (!objectKey) return reply.code(404).send({ message: 'Rapor bulunamadı' })
    if (!options.objectStore) return reply.code(503).send({ message: 'Rapor deposu kullanılamıyor' })
    const html = await options.objectStore.getContent(objectKey)
    return reply.type('text/html; charset=utf-8').send(html)
  })

  app.post('/:id/messages', async (request, reply) => {
    const key = idempotencyKeySchema.safeParse(request.headers['idempotency-key'])
    const body = messageSchema.safeParse(request.body)
    if (!key.success || !body.success) return reply.code(400).send({ message: 'Geçerli Idempotency-Key ve boş olmayan mesaj gereklidir' })
    const { id } = request.params as { id: string }
    try {
      const report = await options.repository.getTopicDetail(id)
      if (report?.reportCard === 'K6' && !report.documentId) {
        const dependencies = draftDependencies(reply)
        if (!dependencies) return reply
        if (!options.revisionModel) return reply.code(503).send({message:'Rapor düzeltme modeli kullanılamıyor.'})
        await reviseRunReport({id,message:body.data.message,requestKey:key.data}, {...dependencies,aiModel:options.revisionModel,model:options.revisionModelName ?? 'gemini-3.7-flash'})
        return reply.send({messageId:key.data,status:'COMPLETED'})
      }
      return reply.code(202).send(await options.repository.appendRevisionRequest({
        topicId: id, requestKey: key.data, message: body.data.message, revisionKind: classifyRevisionKind(),
      }))
    } catch (error) {
      if (error instanceof TopicNotFoundError) return reply.code(404).send({ message: error.message })
      if (error instanceof TopicCommandConflictError) return reply.code(409).send({ message: error.message })
      return replyDraftError(reply,error)
    }
  })

  app.post('/:id/retry', async (request, reply) => {
    const key = idempotencyKeySchema.safeParse(request.headers['idempotency-key'])
    if (!key.success) return reply.code(400).send({ message: 'Geçerli Idempotency-Key gereklidir' })
    const { id } = request.params as { id: string }
    try {
      return reply.code(202).send(await options.repository.requestTopicRetry(id, key.data))
    } catch (error) {
      if (error instanceof TopicNotFoundError) return reply.code(404).send({ message: error.message })
      if (error instanceof TopicRetryConflictError || error instanceof TopicCommandConflictError) return reply.code(409).send({ message: error.message })
      throw error
    }
  })

  app.get('/:id/draft', async (request, reply) => {
    const dependencies = draftDependencies(reply)
    if (!dependencies) return reply
    const { id } = request.params as { id: string }
    const view = await getReportDraftView(id, dependencies)
    if (!view) return reply.code(404).send({ message: 'Bu mevzuat için yayımlanmış bir bülten yok' })
    return reply.send({...toDraftPayload(view),isProcessing:await options.repository.hasPendingReportRevisionWork?.(id) ?? false})
  })

  for (const mode of ['workspace', 'sources'] as const) {
    app.post(`/:id/draft/${mode}`, async (request, reply) => {
      const dependencies = draftDependencies(reply)
      if (!dependencies) return reply
      const key = idempotencyKeySchema.safeParse(request.headers['idempotency-key'])
      const schema = mode === 'workspace'
        ? z.union([z.object({expectedVersion: versionSchema.optional(),expectedDraftUpdatedAt:z.string().datetime().nullable().optional(), customization: ReportCustomizationSchema.nullable()}).strict(),z.object({expectedVersion: versionSchema.optional(),expectedDraftUpdatedAt:z.string().datetime().nullable().optional(), templateId: z.string().min(1)}).strict()])
        : z.object({expectedVersion: versionSchema.optional(),expectedDraftUpdatedAt:z.string().datetime().nullable().optional(), source: ReportSourceSchema.omit({id: true}).refine(source => source.kind !== 'URL' || Boolean(source.url))}).strict()
      const body = schema.safeParse(request.body)
      if (!key.success || !body.success) return reply.code(400).send({message: 'Geçerli Idempotency-Key ve çalışma alanı bilgileri gereklidir'})
      const {id} = request.params as {id: string}
      try {
        const current = await getReportDraftView(id, dependencies)
        if (!current) return reply.code(404).send({message: 'Yayımlanmış rapor bulunamadı'})
        const suppliedSources = 'source' in body.data ? [body.data.source] : 'customization' in body.data ? body.data.customization?.sources ?? [] : []
        for (const source of suppliedSources) {
          if (!source.documentVersionId) continue
          const version = await options.loadDocumentVersion?.(source.documentVersionId)
          if (!version) return reply.code(404).send({ message: 'Belge sürümü bulunamadı.' })
          // Legacy topics are shared corporate reports. A private upload must stay in
          // its private analysis/report flow until an explicit sharing contract exists.
          if (getActorContext() && version.visibility !== 'WORKSPACE') return reply.code(403).send({ message: 'Kişisel belge ortak rapora doğrudan eklenemez. Belge arşivinden özel analiz ve rapor oluşturabilirsiniz.' })
          if (!version.text?.trim()) return reply.code(422).send({ message: 'Belgenin okunabilir metni hazır değil.' })
          Object.assign(source, { label: version.title, url: version.url ?? '', content: version.text.slice(0, 100000), kind: 'FILE', ...(version.filename ? { fileName: version.filename } : {}) })
        }
        let value = 'templateId' in body.data ? {...ReportCustomizationSchema.parse(current.spec.customization ?? {}),templateId: body.data.templateId} : 'customization' in body.data ? body.data.customization
          : {...ReportCustomizationSchema.parse(current.spec.customization ?? {}), sources: [...(current.spec.customization?.sources ?? []), {...body.data.source, id: randomUUID()}]}
        if (mode === 'workspace' && value?.templateId && ('templateId' in body.data || value.templateId !== current.spec.customization?.templateId || /\{\{/.test(JSON.stringify(value)))) {
          if (!options.loadTemplate) return reply.code(503).send({message: 'Şablon deposu kullanılamıyor'})
          const template = await options.loadTemplate(value.templateId)
          if (!template) return reply.code(404).send({message: 'Şablon bulunamadı'})
          value = applyAutomationTemplate({...current.spec,customization: value}, {templateId: value.templateId,template}).customization ?? null
        }
        const view = await applyReportFieldEdits({topicId: id, patch: {edits: [{path: 'customization', value}]}, ...(body.data.expectedVersion === undefined ? {} : {expectedVersion: body.data.expectedVersion}), ...(body.data.expectedDraftUpdatedAt === undefined ? {} : {expectedDraftUpdatedAt:body.data.expectedDraftUpdatedAt}), requestKey: key.data, source: 'USER', prompt: null, chatMessageId: null, actor: null}, dependencies)
        return reply.send(toDraftPayload(view))
      } catch (error) { return replyDraftError(reply,error) }
    })
  }

  app.post('/:id/draft/edits', async (request, reply) => {
    const dependencies = draftDependencies(reply)
    if (!dependencies) return reply
    const key = idempotencyKeySchema.safeParse(request.headers['idempotency-key'])
    const body = applyEditsSchema.safeParse(request.body)
    if (!key.success || !body.success) return reply.code(400).send({ message: 'Geçerli Idempotency-Key ve düzenleme listesi gereklidir' })
    const { id } = request.params as { id: string }
    try {
      const view = await applyReportFieldEdits({
        topicId: id,
        patch: { edits: body.data.edits },
        ...(body.data.expectedDraftUpdatedAt === undefined ? {} : {expectedDraftUpdatedAt:body.data.expectedDraftUpdatedAt}),
        ...(body.data.expectedVersion === undefined ? {} : { expectedVersion: body.data.expectedVersion }),
        requestKey: key.data,
        source: 'USER',
        prompt: null,
        chatMessageId: null,
        actor: null,
      }, dependencies)
      return reply.send(toDraftPayload(view))
    } catch (error) {
      return replyDraftError(reply, error)
    }
  })

  app.post('/:id/draft/edits/:editId/revert', async (request, reply) => {
    const dependencies = draftDependencies(reply)
    if (!dependencies) return reply
    const { id, editId } = request.params as { id: string; editId: string }
    try {
      return reply.send(toDraftPayload(await revertReportFieldEdit({ topicId: id, editId, actor: null }, dependencies)))
    } catch (error) {
      return replyDraftError(reply, error)
    }
  })

  app.get('/:id/draft/history',async(request,reply)=>{
    const dependencies=draftDependencies(reply)
    if(!dependencies)return reply
    const {id}=request.params as {id:string}
    return {revisions:await dependencies.repository.getPublishedHistory?.(id) ?? []}
  })

  app.post('/:id/draft/publish', async (request, reply) => {
    const dependencies = draftDependencies(reply)
    if (!dependencies) return reply
    const writer = options.objectStore?.putRunFile ? (options.objectStore as TopicObjectStore) : null
    if (!writer) return reply.code(503).send({ message: 'Rapor deposu yazma için kullanılamıyor' })
    const body = publishDraftSchema.safeParse(request.body ?? {})
    if (!body.success) return reply.code(400).send({ message: 'Geçerli yayımlama isteği gereklidir' })
    const { id } = request.params as { id: string }
    try {
      const stored = await publishReportDraft({
        topicId: id,
        ...(body.data.expectedDraftUpdatedAt === undefined ? {} : {expectedDraftUpdatedAt:body.data.expectedDraftUpdatedAt}),
        ...(body.data.expectedVersion === undefined ? {} : { expectedVersion: body.data.expectedVersion }),
      }, {
        repository: dependencies.repository,
        topicRepository: options.repository,
        objectStore: writer,
      })
      return reply.code(201).send({ reportId: stored.id, revisionId: stored.revisionId, version: stored.version, card: stored.card, basename: stored.basename })
    } catch (error) {
      return replyDraftError(reply, error)
    }
  })

  app.delete('/:id/draft', async (request, reply) => {
    const dependencies = draftDependencies(reply)
    if (!dependencies) return reply
    const { id } = request.params as { id: string }
    await discardReportDraft(id, dependencies)
    return reply.code(204).send()
  })

  function draftDependencies(reply: FastifyReply) {
    if (!options.draftRepository || !options.objectStore) {
      void reply.code(503).send({ message: 'Revizyon taslağı servisi kullanılamıyor' })
      return null
    }
    return { repository: options.draftRepository, objectStore: options.objectStore }
  }
}

function toDraftPayload(view: ReportDraftView) {
  return {
    // Null while the report still matches its published revision; the preview and
    // the base version are useful either way.
    draft: view.draft
      ? {
        id: view.draft.id,
        status: view.draft.status,
        updatedAt: view.draft.updatedAt,
        edits: view.draft.edits,
      }
      : null,
    baseVersion: view.baseVersion,
    publishedVersion: view.publishedVersion,
    isStale: view.draft !== null && view.publishedVersion > view.baseVersion,
    spec: view.spec,
    html: view.html,
  }
}

function replyDraftError(reply: FastifyReply, error: unknown) {
  if(error instanceof ReportDraftChangedError)return reply.code(409).send({category:'DRAFT_UPDATED',message:error.message})
  if(error instanceof ReportDraftBusyError)return reply.code(409).send({category:'REVISION_IN_PROGRESS',message:error.message})
  if (error instanceof ReportDraftConflictError) {
    return reply.code(409).send({ message: error.message, currentVersion: error.currentVersion })
  }
  if (error instanceof ReportPatchError) {
    return reply.code(400).send({ message: error.message, reason: error.reason, path: error.path ?? null })
  }
  if (error instanceof ReportNotPublishedError) {
    return reply.code(404).send({ message: error.message })
  }
  throw error
}
import { getActorContext } from '../../platform/actor-context'
