import { extractDocumentVersion } from './modules/documents/application/extract-document'
import { getActorContext as chatActor, hasPermission as chatPermission, privateActorScope as chatScope } from './platform/actor-context'
import { ReportAnalysisService } from './modules/operations/report-analysis-service'
import { PrismaChatReportCreator } from './modules/chat/infrastructure/prisma-chat-report-creator'
import { connectorRoutes } from './modules/managed-sources/connector.routes'
import { templateAiRoutes } from './modules/workspace/template-ai.routes'
import { PrismaUsageRecorder } from './modules/usage/prisma-usage-recorder'
import type { BrowserResearch } from './modules/chat/application/browser-research'
import type { AiModelClient } from './modules/ai/application/ai-model-client'
import { StandaloneReportsService, standaloneReportRoutes } from './modules/operations/standalone-reports'
import type { DocumentStore } from './modules/documents/application/import-document'
import { documentsRoutes } from './modules/documents/documents.routes'
import { OperationService, type OperationExecutor } from './modules/operations/operation-service'
import { operationsRoutes } from './modules/operations/operations.routes'
import { automationOperationRoutes } from './modules/operations/automation-operations.routes'
import { scanSupported } from './modules/workspace/catalog'
import { sourceProfileRoutes } from './modules/managed-sources/source-profile.routes'
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { authRoutes } from './modules/auth/auth.routes'
import { createAuthRuntime, type AuthRuntime } from './modules/auth/runtime'
import { installAuth } from './modules/auth/guard'
import { documentAccessWhere } from './platform/actor-context'
import { chatRoutes } from './modules/chat/chat.routes'
import { PrismaChatRepository } from './modules/chat/infrastructure/prisma-chat-repository'
import { UnavailableChatModelClient } from './modules/chat/infrastructure/gemini-chat-model-client'
import type { ChatModelClient } from './modules/chat/application/chat-model-client'
import type { ChatRepository } from './modules/chat/application/ports'
import type { AssistantKnowledge } from './modules/chat/application/assistant-knowledge'
import type { ChatScanStarter } from './modules/chat/application/chat-tools'
import { PrismaAssistantKnowledge } from './modules/chat/infrastructure/prisma-assistant-knowledge'
import { prisma } from './platform/database'
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
import { workspaceRoutes } from './modules/workspace/workspace.routes'
import { managedSourceRoutes } from './modules/managed-sources/managed-source.routes'
import { sourceDiscoveryRoutes } from './modules/managed-sources/source-discovery.routes'
import { sourceScanRunRoutes } from './modules/managed-sources/source-scan-runs.routes'
import { tariffCredentialsFromEnv } from './modules/managed-sources/tariff-auth'
import type { TariffLookup } from './modules/tariff/tariff-lookup'

interface BuildAppOptions {
  /** Explicit test-only fixture for feature contract tests; never accepted by the server runtime. */
  authRuntime?: AuthRuntime | false
  documentStore?: DocumentStore
  operationsService?: OperationService
  modularOperationsEnabled?: boolean
  scanRepository?: PrismaScanRepository
  topicRepository?: PrismaTopicAnalysisRepository
  objectStore?: Pick<TopicObjectStore, 'getContent'> & Partial<Pick<TopicObjectStore, 'putRunFile'>>
  revisionModel?: AiModelClient
  draftRepository?: ReportDraftRepository
  deliveryRepository?: PrismaDeliveryRepository
  pdfRenderer?: PdfRenderer
  mailSender?: MailSender
  mailSenderIdentity?: { address: string | undefined; name: string }
  timezone?: string
  chatRepository?: ChatRepository
  usageRecorder?: import('./modules/usage/measurement').UsageRecorder
  browserResearch?:BrowserResearch
  chatModel?: ChatModelClient
  chatModelName?: string
  chatKnowledge?: AssistantKnowledge
  chatScanStarter?: ChatScanStarter
  tariffLookup?: TariffLookup | undefined
  componentStudio?: import('./modules/chat/application/component-studio').ComponentStudio | undefined
  healthChecks?: HealthChecks
}

export interface HealthChecks {
  database: () => Promise<void>
  queue: () => Promise<void>
  objectStore: () => Promise<void>
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.x-csrf-token', 'res.headers.set-cookie'],
      serializers: { req: (request: any) => ({ method: request.method, url: String(request.url ?? request.raw?.url ?? '').split('?')[0] ?? '/', hostname: request.hostname, remoteAddress: request.ip }) },
    },
  })

  if (options.authRuntime === false && process.env.NODE_ENV !== 'test') throw new Error('Authentication cannot be disabled outside explicit test fixtures.')
  const authentication = options.authRuntime === false ? null : options.authRuntime ?? await createAuthRuntime({ prisma })

  await app.register(cors, {
    origin: authentication?.config.publicOrigin ?? true,
    credentials: true,
  })
  if (authentication) await installAuth(app, { runtime: authentication })

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
  if (authentication) app.register(authRoutes, { prefix: '/api/auth', runtime: authentication })
  const modularOperationsEnabled = options.modularOperationsEnabled ?? process.env.MODULAR_OPERATIONS_ENABLED === 'true'
  const availableExecutor: OperationExecutor = async () => { throw new Error('İşlemler worker tarafından yürütülür.') }
  const operations = options.operationsService ?? (modularOperationsEnabled ? new OperationService(prisma, { executors: { DISCOVER: availableExecutor, CAPTURE: availableExecutor, EXTRACT: availableExecutor, FILTER: availableExecutor, PREVIOUS_SOURCES: availableExecutor, ANALYZE: availableExecutor, REVISE_ANALYSIS: availableExecutor, BUILD_REPORT: availableExecutor, REVISE_REPORT: availableExecutor, ...(options.tariffLookup ? { TARIFF_LOOKUP: availableExecutor } : {}) }, versions: { ANALYZE: `standalone-v2.1-roles:${options.chatModelName ?? 'gemini-3.7-flash'}`, EXTRACT: 'document-extractor-v2', BUILD_REPORT: 'corporate-draft-v1' } }) : undefined)
  if (modularOperationsEnabled && options.documentStore) app.register(documentsRoutes, { prefix: '/api/v1', prisma, objectStore: options.documentStore })
  if (operations) app.register(operationsRoutes, { prefix: '/api/v1', service: operations })
  if (operations) app.register(automationOperationRoutes, { prefix: '/api/v1', service: operations })
  if (modularOperationsEnabled && options.documentStore?.putRunFile) app.register(standaloneReportRoutes, { prefix: '/api/v1', service: new StandaloneReportsService(prisma, { getContent: key => options.documentStore!.getContent(key), putRunFile: (key, body, type) => options.documentStore!.putRunFile!(key, body, type) }) })
  const scanRepository = options.scanRepository ?? new PrismaScanRepository(prisma)
  const chatModel = options.chatModel ?? new UnavailableChatModelClient('Gemini API anahtarı yapılandırılmamış.')
  app.register(chatRoutes, {
    prefix: '/api/v1/chat',
    ...(options.documentStore && options.revisionModel ? {prepareDocument:async (versionId:string)=>{
      const actor=chatActor()
      if(actor && !chatPermission(actor,'analysis.run'))throw new Error('Belge işleme yetkisi gerekli.')
      await extractDocumentVersion({prisma,objectStore:options.documentStore!,aiModel:options.revisionModel!,model:options.chatModelName??'gemini-3.7-flash'},versionId,chatScope())
    }} : {}),
    ...(modularOperationsEnabled && options.documentStore?.putRunFile && options.revisionModel ? {reportCreator:new PrismaChatReportCreator(prisma,{getContent:key=>options.documentStore!.getContent(key),putRunFile:(key,body,type)=>options.documentStore!.putRunFile!(key,body,type)},options.revisionModel,options.chatModelName??'gemini-3.7-flash')}:{}),
    ...((options.usageRecorder || !options.chatRepository) ? {usageRecorder: options.usageRecorder ?? new PrismaUsageRecorder(prisma)} : {}),
    repository: options.chatRepository ?? new PrismaChatRepository(prisma),
    model: chatModel,
    ...(options.browserResearch?{browserResearch:options.browserResearch}:{}),
    ...(operations ? { operations } : {}),
    tariffLookup: options.tariffLookup,
    componentStudio: options.componentStudio,
    modelName: options.chatModelName ?? 'gemini-3.6-flash',
    knowledge: options.chatKnowledge ?? new PrismaAssistantKnowledge(prisma, {
      getContent: async (objectKey: string) => {
        if (!options.objectStore) throw new Error('Nesne deposu yapılandırılmamış.')
        return options.objectStore.getContent(objectKey)
      },
    }),
    scanStarter: options.chatScanStarter ?? {
      startScan: (input) => scanRepository.createManualRun(input),
    },
  })
  const topicRepository = options.topicRepository ?? new PrismaTopicAnalysisRepository(prisma)
  app.register(scanRunsRoutes, {
    prefix: '/api/v1/scan-runs',
    validateSourceKeys: async (keys: string[]) => { const sources=await prisma.source.findMany({where:{key:{in:keys},isActive:true},include:{profiles:{select:{status:true}},credentials:{select:{id:true}}}});if(sources.length!==new Set(keys).size||sources.some(s=>!scanSupported(s)))throw new Error('Seçilen kaynak için doğrulanmış profil ve gerekli hesap bağlantısı olmalı.') },
    ...(options.timezone ? { timezone: options.timezone } : {}),
    repository: scanRepository,
    topicRepository,
    ...(options.objectStore ? { objectStore: options.objectStore } : {}),
  })
  app.register(topicAnalysisRoutes, {
    prefix: '/api/v1/topics',
    ...(options.objectStore ? {reportAnalysis:new ReportAnalysisService(prisma,options.objectStore,options.revisionModel,options.chatModelName)} : {}),
    ...((options.usageRecorder || !options.topicRepository) ? {usageRecorder: options.usageRecorder ?? new PrismaUsageRecorder(prisma)} : {}),
    ...(options.revisionModel ? { revisionModel: options.revisionModel } : {}),
    ...(options.chatModelName ? { revisionModelName: options.chatModelName } : {}),
    repository: topicRepository,
    draftRepository: options.draftRepository ?? new PrismaReportDraftRepository(prisma),
    loadTemplate: (id: string) => prisma.reportTemplate.findUnique({ where: { id } }),
    ...(modularOperationsEnabled ? { loadDocumentVersion: async (id: string) => {
      const version = await prisma.documentVersion.findFirst({ where: { id, document: documentAccessWhere() }, include: { document: true } })
      return version ? { id: version.id, title: version.document.title, url: version.document.canonicalUrl, text: version.extractedText, filename: version.originalFilename, visibility: version.document.visibility } : null
    } } : {}),
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

  app.register(sourceProfileRoutes, { prefix: '/api/v1/source-profiles', prisma })
  app.register(workspaceRoutes, { prisma, modularOperationsEnabled })
  app.register(templateAiRoutes, { prisma, ...(options.revisionModel ? {aiModel:options.revisionModel} : {}), modelName:options.chatModelName ?? 'gemini-3.7-flash' })
  app.register(connectorRoutes, { prefix: '/api/v1/connectors', prisma })
  app.register(managedSourceRoutes, { prefix: '/api/v1/managed-sources', prisma })
  app.register(sourceDiscoveryRoutes, { prefix: '/api/v1/source-sites', prisma, model: chatModel, modelName: options.chatModelName ?? 'gemini-3.7-flash' })
  app.register(sourceScanRunRoutes, { prefix: '/api/v1/source-scan-runs', prisma, ...(operations ? { operations } : {}), tariffCredentials: tariffCredentialsFromEnv(), ...(options.objectStore ? { objectStore: options.objectStore } : {}) })
  return app
}
