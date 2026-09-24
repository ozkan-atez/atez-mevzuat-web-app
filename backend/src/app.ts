import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { authRoutes } from './modules/auth/auth.routes'
import { chatRoutes } from './modules/chat/chat.routes'
import { PrismaChatRepository } from './modules/chat/infrastructure/prisma-chat-repository'
import { UnavailableChatModelClient } from './modules/chat/infrastructure/gemini-chat-model-client'
import type { ChatModelClient } from './modules/chat/application/chat-model-client'
import type { AiModelClient } from './modules/ai/application/ai-model-client'
import type { ChatRepository } from './modules/chat/application/ports'
import type { AssistantKnowledge } from './modules/chat/application/assistant-knowledge'
import { PrismaAssistantKnowledge } from './modules/chat/infrastructure/prisma-assistant-knowledge'
import type { OfficialLookup } from './modules/chat/infrastructure/official-document-lookup'
import { prisma } from './platform/database'
import { reportTemplateRoutes } from './modules/report-templates/report-template.routes'
import { buildPresetHtml } from './modules/report-templates/template-composer'
import { suggestTemplate } from './modules/report-templates/suggest-template'
import { managedSourceRoutes } from './modules/managed-sources/managed-source.routes'
import { sourceDiscoveryRoutes } from './modules/managed-sources/source-discovery.routes'
import { sourceScanRunRoutes } from './modules/managed-sources/source-scan-runs.routes'
import { tariffCredentialsFromEnv } from './modules/managed-sources/tariff-auth'
import { PrismaScanRepository } from './modules/scan-runs/infrastructure/prisma-scan-repository'
import { scanRunsRoutes } from './modules/scan-runs/scan-runs.routes'
import { PrismaTopicAnalysisRepository } from './modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'
import { topicAnalysisRoutes } from './modules/topic-analysis/topic-analysis.routes'
import { PrismaReportDraftRepository } from './modules/topic-analysis/infrastructure/prisma-report-draft-repository'
import type { ReportDraftRepository } from './modules/topic-analysis/application/ports'
import { customerGroupRoutes, topicDeliveryRoutes } from './modules/delivery/delivery.routes'
import { PrismaDeliveryRepository } from './modules/delivery/infrastructure/prisma-delivery-repository'
import type { MailSender, PdfRenderer } from './modules/delivery/application/ports'
import type { TopicObjectStore } from './modules/topic-analysis/application/ports'

interface BuildAppOptions {
  scanRepository?: PrismaScanRepository
  topicRepository?: PrismaTopicAnalysisRepository
  objectStore?: Pick<TopicObjectStore, 'getContent'> & Partial<Pick<TopicObjectStore, 'putRunFile'>> & { deleteRunFile?(key: string): Promise<void> }
  draftRepository?: ReportDraftRepository
  deliveryRepository?: PrismaDeliveryRepository
  pdfRenderer?: PdfRenderer
  mailSender?: MailSender
  mailSenderIdentity?: { address: string | undefined; name: string }
  timezone?: string
  chatRepository?: ChatRepository
  chatModel?: ChatModelClient
  chatModelName?: string
  chatKnowledge?: AssistantKnowledge
  officialLookup?: OfficialLookup
  reportPatchModel?: AiModelClient
  reportPatchModelName?: string
  healthChecks?: HealthChecks
  corsOrigin?: string | string[] | boolean
}

export interface HealthChecks {
  database: () => Promise<void>
  queue: () => Promise<void>
  objectStore: () => Promise<void>
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
  })

  await app.register(cors, {
    origin: options.corsOrigin ?? true,
    credentials: true,
  })

  app.get('/api/health', async (_request, reply) => {
    const entries = Object.entries(options.healthChecks ?? {
      database: async () => undefined,
      queue: async () => undefined,
      objectStore: async () => undefined,
    }) as Array<[keyof HealthChecks, () => Promise<void>]>
    const results = await Promise.all(entries.map(async ([name, check]) => {
      try {
        await check()
        return [name, 'ready'] as const
      } catch {
        return [name, 'unavailable'] as const
      }
    }))
    const dependencies = Object.fromEntries(results)
    const ready = results.every(([, status]) => status === 'ready')
    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'unavailable',
      dependencies,
      timestamp: new Date().toISOString(),
    })
  })

  // Register Modules
  const scanRepository = options.scanRepository ?? new PrismaScanRepository(prisma)
  app.register(authRoutes, { prefix: '/api/auth' })
  app.register(reportTemplateRoutes, { prefix: '/api/v1/report-templates', prisma, ...(options.reportPatchModel ? { model: options.reportPatchModel } : {}), ...(options.reportPatchModelName ? { modelName: options.reportPatchModelName } : {}) })
  app.register(managedSourceRoutes, { prefix: '/api/v1/managed-sources', prisma })
  app.register(sourceDiscoveryRoutes, { prefix: '/api/v1/source-sites', prisma, model: options.chatModel ?? new UnavailableChatModelClient('Gemini API anahtarı yapılandırılmamış.'), modelName: options.chatModelName ?? 'gemini-3.6-flash' })
  app.register(sourceScanRunRoutes, { prefix: '/api/v1/source-runs', prisma, tariffCredentials: tariffCredentialsFromEnv() })
  app.register(chatRoutes, {
    prefix: '/api/v1/chat',
    repository: options.chatRepository ?? new PrismaChatRepository(prisma, options.objectStore?.putRunFile
      ? options.objectStore as Required<Pick<TopicObjectStore, 'getContent' | 'putRunFile'>> & { deleteRunFile?(key: string): Promise<void> } : undefined),
    model: options.chatModel ?? new UnavailableChatModelClient('Gemini API anahtarı yapılandırılmamış.'),
    modelName: options.chatModelName ?? 'gemini-3.6-flash',
    startRun: async (input) => {
      try {
        return await scanRepository.createManualRun(input)
      } catch (error) {
        app.log.error({ err: error, targetDate: input.targetDate }, 'Sohbetten tarama başlatılamadı')
        throw error
      }
    },
    listTemplates: async () => prisma.reportTemplate.findMany({ select: { id: true, name: true, description: true }, orderBy: { updatedAt: 'desc' }, take: 25 }),
    createTemplate: async ({ request, preset }) => {
      if (!options.reportPatchModel || !options.reportPatchModelName) throw new Error('AI şablon oluşturucusu kullanılamıyor.')
      const suggested = await suggestTemplate({ message: request, name: '', description: null, html: buildPresetHtml(preset) }, options.reportPatchModel, options.reportPatchModelName)
      const template = await prisma.reportTemplate.create({ data: { name: suggested.name, description: suggested.description, html: suggested.html } })
      return { id: template.id, name: template.name }
    },
    knowledge: options.chatKnowledge ?? new PrismaAssistantKnowledge(prisma, {
      getContent: async (objectKey: string) => {
        if (!options.objectStore) throw new Error('Nesne deposu yapılandırılmamış.')
        return options.objectStore.getContent(objectKey)
      },
    }, options.officialLookup),
  })
  const topicRepository = options.topicRepository ?? new PrismaTopicAnalysisRepository(prisma)
  app.register(scanRunsRoutes, {
    prefix: '/api/v1/scan-runs',
    ...(options.timezone ? { timezone: options.timezone } : {}),
    repository: scanRepository,
    topicRepository,
    ...(options.reportPatchModel ? { reportPatchModel: options.reportPatchModel } : {}),
    ...(options.reportPatchModelName ? { reportPatchModelName: options.reportPatchModelName } : {}),
    ...(options.objectStore ? { objectStore: options.objectStore } : {}),
    ...(options.pdfRenderer ? { pdfRenderer: options.pdfRenderer } : {}),
  })
  app.register(topicAnalysisRoutes, {
    prefix: '/api/v1/topics',
    repository: topicRepository,
    draftRepository: options.draftRepository ?? new PrismaReportDraftRepository(prisma),
    ...(options.objectStore ? { objectStore: options.objectStore } : {}),
  })

  const deliveryRepository = options.deliveryRepository ?? new PrismaDeliveryRepository(prisma)
  app.register(customerGroupRoutes, { prefix: '/api/v1/customer-groups', repository: deliveryRepository })
  app.register(topicDeliveryRoutes, {
    prefix: '/api/v1/topics',
    repository: deliveryRepository,
    topicRepository,
    ...(options.objectStore ? { objectStore: options.objectStore } : {}),
    ...(options.pdfRenderer ? { pdfRenderer: options.pdfRenderer } : {}),
    ...(options.mailSender ? { mailSender: options.mailSender } : {}),
    ...(options.mailSenderIdentity ? { sender: options.mailSenderIdentity } : {}),
  })

  return app
}
