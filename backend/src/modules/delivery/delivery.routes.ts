import type { FastifyInstance } from 'fastify'
import { idempotencyKeySchema } from '../scan-runs/scan-runs.schemas'
import type { PrismaTopicAnalysisRepository } from '../topic-analysis/infrastructure/prisma-topic-analysis-repository'
import type { TopicObjectStore } from '../topic-analysis/application/ports'
import { buildEmailDraft, renderEmailHtml } from './application/build-email-draft'
import { DeliveryError } from './domain/delivery-errors'
import type { MailSender, PdfRenderer } from './application/ports'
import {
  CustomerGroupConflictError,
  CustomerGroupNotFoundError,
  DispatchConflictError,
  type PrismaDeliveryRepository,
} from './infrastructure/prisma-delivery-repository'
import { customerGroupCreateSchema, customerGroupUpdateSchema, dispatchSchema } from './delivery.schemas'

interface Options {
  repository: PrismaDeliveryRepository
  topicRepository: PrismaTopicAnalysisRepository
  objectStore?: Pick<TopicObjectStore, 'getContent'>
  pdfRenderer?: PdfRenderer
  mailSender?: MailSender
  sender?: { address: string | undefined; name: string }
}

export async function customerGroupRoutes(app: FastifyInstance, options: Pick<Options, 'repository'>) {
  app.get('/', async (_request, reply) => reply.send({ groups: await options.repository.listCustomerGroups() }))

  app.post('/', async (request, reply) => {
    const body = customerGroupCreateSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ message: 'Grup adı ve en az bir geçerli e-posta gereklidir' })
    try {
      const group = await options.repository.createCustomerGroup({
        name: body.data.name,
        description: body.data.description ?? null,
        emails: normalizeEmails(body.data.emails),
        isActive: body.data.isActive,
      })
      return reply.code(201).send(group)
    } catch (error) {
      if (error instanceof CustomerGroupConflictError) return reply.code(409).send({ message: error.message })
      throw error
    }
  })

  app.patch('/:id', async (request, reply) => {
    const body = customerGroupUpdateSchema.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ message: 'Geçerli grup alanları gereklidir' })
    const { id } = request.params as { id: string }
    try {
      return reply.send(await options.repository.updateCustomerGroup(id, {
        ...(body.data.name === undefined ? {} : { name: body.data.name }),
        ...(body.data.description === undefined ? {} : { description: body.data.description ?? null }),
        ...(body.data.emails === undefined ? {} : { emails: normalizeEmails(body.data.emails) }),
        ...(body.data.isActive === undefined ? {} : { isActive: body.data.isActive }),
      }))
    } catch (error) {
      if (error instanceof CustomerGroupNotFoundError) return reply.code(404).send({ message: error.message })
      if (error instanceof CustomerGroupConflictError) return reply.code(409).send({ message: error.message })
      throw error
    }
  })

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await options.repository.deleteCustomerGroup(id)
      return reply.code(204).send()
    } catch (error) {
      if (error instanceof CustomerGroupNotFoundError) return reply.code(404).send({ message: error.message })
      throw error
    }
  })
}

export async function topicDeliveryRoutes(app: FastifyInstance, options: Options) {
  const loadContext = async (topicId: string, version: number) => {
    const context = await options.topicRepository.getTopicReportContext(topicId, version)
    if (!context) return null
    const analysisJson = context.analysisObjectKey && options.objectStore
      ? JSON.parse((await options.objectStore.getContent(context.analysisObjectKey)).toString('utf-8')) as unknown
      : null
    return {
      context,
      draft: buildEmailDraft({
        analysisJson,
        fallbackTitle: context.title,
        gazetteUrl: context.sourceUrl,
        targetDate: context.targetDate,
        previousSource: context.previousSource,
      }),
    }
  }

  app.get('/:id/reports/:revision/delivery', async (request, reply) => {
    const { id, revision } = request.params as { id: string; revision: string }
    const version = Number(revision)
    if (!Number.isInteger(version) || version < 1) return reply.code(400).send({ message: 'Geçerli rapor revizyonu gereklidir' })
    const loaded = await loadContext(id, version)
    if (!loaded) return reply.code(404).send({ message: 'Rapor bulunamadı' })
    return reply.send({
      topicId: loaded.context.topicId,
      reportVersion: loaded.context.reportVersion,
      targetDate: loaded.context.targetDate,
      sources: loaded.draft.sources,
      draft: {
        subject: loaded.draft.subject,
        bodyText: loaded.draft.bodyText,
        attachmentName: loaded.draft.attachmentName,
      },
      sender: options.mailSender?.configured
        ? { configured: true as const, address: options.sender?.address ?? null, name: options.sender?.name ?? null }
        : { configured: false as const, note: 'Microsoft Graph yapılandırması eksik; gönderim simüle edilir.' },
      groups: await options.repository.listCustomerGroups(),
      dispatches: await options.repository.listTopicDispatches(id),
    })
  })

  app.get('/:id/reports/:revision/pdf', async (request, reply) => {
    const { id, revision } = request.params as { id: string; revision: string }
    const version = Number(revision)
    if (!Number.isInteger(version) || version < 1) return reply.code(400).send({ message: 'Geçerli rapor revizyonu gereklidir' })
    if (!options.objectStore || !options.pdfRenderer) return reply.code(503).send({ message: 'PDF servisi kullanılamıyor' })
    const loaded = await loadContext(id, version)
    if (!loaded) return reply.code(404).send({ message: 'Rapor bulunamadı' })
    const html = (await options.objectStore.getContent(loaded.context.htmlObjectKey)).toString('utf-8')
    try {
      const pdf = await options.pdfRenderer.renderHtml(html)
      return reply
        .type('application/pdf')
        .header('Content-Disposition', `attachment; filename="${loaded.draft.attachmentName}"`)
        .send(pdf)
    } catch (error) {
      if (error instanceof DeliveryError) return reply.code(502).send({ message: error.message })
      throw error
    }
  })

  app.post('/:id/dispatches', async (request, reply) => {
    const key = idempotencyKeySchema.safeParse(request.headers['idempotency-key'])
    const body = dispatchSchema.safeParse(request.body)
    if (!key.success || !body.success) return reply.code(400).send({ message: 'Geçerli Idempotency-Key ve gönderim alanları gereklidir' })
    const { id } = request.params as { id: string }

    const loaded = await loadContext(id, body.data.reportVersion)
    if (!loaded) return reply.code(404).send({ message: 'Rapor bulunamadı' })

    const recipients = normalizeEmails([
      ...body.data.recipients,
      ...await options.repository.resolveGroupRecipients(body.data.groupIds),
    ])
    if (recipients.length === 0) return reply.code(400).send({ message: 'En az bir alıcı seçilmelidir' })

    const bodyHtml = renderEmailHtml({ bodyText: body.data.bodyText, sources: loaded.draft.sources })

    let dispatch: { id: string }
    try {
      dispatch = await options.repository.startDispatch({
        topicId: id,
        reportVersion: body.data.reportVersion,
        requestKey: key.data,
        recipients,
        groupIds: body.data.groupIds,
        subject: body.data.subject,
        bodyHtml,
        attachmentName: body.data.attachPdf ? loaded.draft.attachmentName : null,
      })
    } catch (error) {
      if (error instanceof DispatchConflictError) return reply.code(409).send({ message: error.message })
      throw error
    }

    try {
      const attachments = []
      if (body.data.attachPdf) {
        if (!options.objectStore || !options.pdfRenderer) throw new DeliveryError('PDF_UNAVAILABLE', 'PDF servisi kullanılamıyor.')
        const html = (await options.objectStore.getContent(loaded.context.htmlObjectKey)).toString('utf-8')
        attachments.push({
          fileName: loaded.draft.attachmentName,
          mediaType: 'application/pdf',
          content: await options.pdfRenderer.renderHtml(html),
        })
      }

      if (!options.mailSender?.configured) {
        await options.repository.completeDispatch(dispatch.id, { status: 'SIMULATED', providerMessageId: null })
        return reply.code(202).send({
          dispatchId: dispatch.id, status: 'SIMULATED', recipients,
          note: 'Microsoft Graph yapılandırması eksik olduğu için gönderim simüle edildi.',
        })
      }

      const result = await options.mailSender.send({
        to: recipients,
        subject: body.data.subject,
        html: bodyHtml,
        attachments,
      })
      await options.repository.completeDispatch(dispatch.id, { status: result.status, providerMessageId: result.providerMessageId })
      return reply.code(202).send({ dispatchId: dispatch.id, status: result.status, recipients })
    } catch (error) {
      const message = error instanceof DeliveryError ? error.message : 'E-posta gönderimi tamamlanamadı.'
      await options.repository.failDispatch(dispatch.id, message)
      return reply.code(502).send({ dispatchId: dispatch.id, status: 'FAILED', message })
    }
  })
}

function normalizeEmails(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const address = value.trim().toLowerCase()
    if (!address || seen.has(address)) continue
    seen.add(address)
    result.push(address)
  }
  return result
}
