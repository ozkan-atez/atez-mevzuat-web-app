import { dispatchConnectorTests, executeConnectorTest } from './modules/managed-sources/connector-setup'
import { connectorQueueName } from './platform/rabbitmq'
import { backgroundUsageModel, withUsageContext } from './modules/usage/background-usage'
import { PrismaUsageRecorder } from './modules/usage/prisma-usage-recorder'
import { createPreviousSourceExecutor } from './modules/operations/previous-source-executor'
import { runWithActorContext } from './platform/actor-context'
import { withJobActor, workerServiceActor, WorkerAuthorizationError } from './platform/worker-actor'
import { OperationService } from './modules/operations/operation-service'
import { createOperationExecutors } from './modules/operations/executors'
import { createSourceOperationExecutors } from './modules/operations/source-executors'
import { dispatchOperations } from './modules/operations/operation-dispatcher'
import { extractDocumentVersion } from './modules/documents/application/extract-document'
import { operationQueueName } from './platform/rabbitmq'
import { rabbitQueue, sourceQueueName, refreshQueueName } from './platform/rabbitmq'
import { ensureWorkspaceCatalog } from './modules/workspace/catalog'
import { listRunnableSourceKeys } from './modules/managed-sources/runnable-sources'
import { refreshActiveSources } from './modules/managed-sources/refresh-active-sources'
import { executeScanCommand } from './modules/scan-runs/application/execute-scan-command'
import { dispatchSourceRuns, executeSourceCommand } from './modules/managed-sources/source-job'
import { runSelectedSources } from './modules/managed-sources/run-selected-sources'
import type { SourceProcessingDependencies } from './modules/managed-sources/process-source-documents'
import { tariffCredentialsFromEnv } from './modules/managed-sources/tariff-auth'
import { SingleWindowTariffLookup } from './modules/tariff/tariff-lookup'
import { workspaceAutomationQueue, reconcileAutomationSchedules, executeAutomationCommand } from './modules/workspace/automations'
import { startQueue, manualScanQueueName, scheduledScanQueueName, topicAnalysisQueueName } from './platform/queue'
import { prisma } from './platform/database'
import { loadEnv } from './config/env'
import { PrismaScanRepository } from './modules/scan-runs/infrastructure/prisma-scan-repository'
import { RabbitScanQueue } from './modules/scan-runs/infrastructure/scan-run-queue'
import { S3ObjectStore } from './modules/scan-runs/infrastructure/s3-object-store'
import { OfficialHttpClient } from './modules/scan-runs/infrastructure/official-http-client'
import { SourcePolicy } from './modules/scan-runs/domain/source-policy'
import { executeScanRun } from './modules/scan-runs/application/execute-scan-run'
import { createGoogleAi } from './config/google-ai'
import type { AiModelClient } from './modules/ai/application/ai-model-client'
import { AiProviderError } from './modules/ai/domain/ai-errors'
import { GeminiAiModelClient, type GeminiTransport } from './modules/ai/infrastructure/gemini-ai-model-client'
import type { ScanCommand } from './modules/scan-runs/application/ports'
import { ResmiGazeteSearch } from './modules/scan-runs/infrastructure/resmi-gazete-search'
import { PrismaTopicAnalysisRepository } from './modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'
import { RabbitTopicAnalysisQueue, type TopicAnalysisCommand } from './modules/topic-analysis/infrastructure/topic-analysis-queue'
import { executeTopicRevision } from './modules/topic-analysis/application/execute-topic-revision'
import { executePromptPatch } from './modules/topic-analysis/application/execute-prompt-patch'
import { PrismaReportDraftRepository } from './modules/topic-analysis/infrastructure/prisma-report-draft-repository'
import { retryTopicAnalysis } from './modules/topic-analysis/application/retry-topic-analysis'

const usageOperationLabels:Record<string,string>={ANALYZE:'Etki analizi',AI_FILTER:'Belge eleme',FILTER:'Belge eleme',PREVIOUS_SOURCES:'Önceki kaynak araştırması',BUILD_REPORT:'Rapor üretimi',REVISE_REPORT:'Rapor revizyonu',EXTRACT:'Belge okuma',SCAN:'Kaynak taraması'}
async function startWorker() {
  const queue = await startQueue()
  await rabbitQueue.start()
  const env = loadEnv()
  await ensureWorkspaceCatalog(prisma)
  const repository = new PrismaScanRepository(prisma)
  const topicRepository = new PrismaTopicAnalysisRepository(prisma)
  const draftRepository = new PrismaReportDraftRepository(prisma)
  const scanQueue = new RabbitScanQueue(rabbitQueue)
  const topicQueue = new RabbitTopicAnalysisQueue(rabbitQueue)
  const objectStore = new S3ObjectStore(env.s3)
  const http = new OfficialHttpClient(new SourcePolicy(env.sourceHosts), {
    delayMs: env.sourceDelayMs,
    timeoutMs: env.sourceTimeoutMs,
    maxAttempts: env.sourceMaxAttempts,
    maxFileBytes: env.maxFileBytes,
  })
  const tariffCredentials = tariffCredentialsFromEnv()
  const tariffLookup = tariffCredentials ? new SingleWindowTariffLookup(tariffCredentials) : undefined
  const aiModel = createAiModel(env.gemini.timeoutMs)
  const previousSourceSearch = new ResmiGazeteSearch(new SourcePolicy(env.sourceHosts), { timeoutMs: env.sourceTimeoutMs })
  const sourceProcessing: SourceProcessingDependencies = {
    aiModel, http, objectStore, previousSourceSearch, model: env.gemini.model,
    maxAttempts: env.gemini.maxAttempts, maxContentBytes: env.gemini.maxContentBytes,
    maxRunBytes: BigInt(env.maxRunBytes), ...(tariffLookup ? { tariffLookup } : {}),
  }
  await objectStore.ensureBucket()
  // Opt in only after the additive migration is deployed; existing scan workers remain available.
  if (process.env.MODULAR_OPERATIONS_ENABLED === 'true') {
    const operations = new OperationService(prisma, {
      scope: 'local-workspace', versions: { ANALYZE: `standalone-v2.1-roles:${env.gemini.model}`, EXTRACT: 'document-extractor-v2', BUILD_REPORT: 'corporate-draft-v1' },
      executors: {
        ...createOperationExecutors({ prisma, objectStore, aiModel, model: env.gemini.model, maxContextBytes: env.gemini.maxContentBytes,
          ...(tariffLookup ? { tariffLookup } : {}), extract: (id, scope) => extractDocumentVersion({ prisma, objectStore, aiModel, model: env.gemini.model }, id, scope) }),
        ...createSourceOperationExecutors({ prisma, objectStore }),
        PREVIOUS_SOURCES: createPreviousSourceExecutor({ prisma, objectStore, aiModel, model: env.gemini.model, search: previousSourceSearch }),
      },
    })
    await rabbitQueue.work(operationQueueName, async jobs => { for (const job of jobs) {
      const taskId = (job.data as { taskId: string }).taskId
      const task = await prisma.operationTask.findUnique({ where: { id: taskId }, include: { request: true } })
      if (!task) continue
      try { await withJobActor(prisma, { workspaceId: task.workspaceId, initiatorUserId: task.ownerUserId }, task.operation === 'PUBLISH_REPORT' ? 'report.publish' : task.operation === 'BUILD_REPORT' || task.operation === 'REVISE_REPORT' ? 'report.edit' : 'analysis.run', () => withUsageContext({conversationId:(task.parameters as any)?.executionSnapshot?.conversationId ?? task.requestId,conversationType:(task.parameters as any)?.executionSnapshot?.conversationId ? 'GENERAL' : (task.parameters as any)?.automationId ? 'AUTOMATION':'OPERATION',mode:'ANALYSIS',usageLabel:(task.parameters as any)?.executionSnapshot?.automation?.name ? `${(task.parameters as any).executionSnapshot.automation.name} · ${usageOperationLabels[task.operation] ?? 'AI işlemi'}` : `Belge işlemi · ${usageOperationLabels[task.operation] ?? 'AI işlemi'}`}, () => operations.execute(taskId))) }
      catch (error) {
        if (!(error instanceof WorkerAuthorizationError)) throw error
        await prisma.operationTask.updateMany({ where: { id: taskId, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'BLOCKED', errorCategory: 'AUTHORIZATION_REVOKED', errorMessage: 'İşi başlatan kullanıcının işlem yetkisi etkin değil.' } })
        await prisma.operationRequest.updateMany({ where: { id: task.requestId, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'BLOCKED' } })
        throw error
      }
    } })
    let relaying = false
    const relay = async () => { if (relaying) return; relaying = true; try { await dispatchOperations(prisma, rabbitQueue) } finally { relaying = false } }
    await relay()
    setInterval(() => void relay().catch(error => console.error('Operation outbox dispatch failed:', error)), 1000)
  }

  let dispatching = false
  const dispatch = async () => {
    if (dispatching) return
    dispatching = true
    try {
    const rows = await repository.claimPendingOutbox(10)
    for (const row of rows) {
      try {
        const queueJobId = await scanQueue.enqueue({ outboxId: row.id, runId: row.scanRunId, type: row.commandType })
        await repository.markOutboxDispatched(row.id, queueJobId)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Queue dispatch failed'
        const delay = Math.min(60_000, 1_000 * 2 ** row.attempts)
        await repository.deferOutbox(row.id, message, new Date(Date.now() + delay))
      }
    }
    const topicRows = await topicRepository.claimPendingTopicOutbox(10)
    for (const row of topicRows) {
      try {
        await topicQueue.enqueue({ outboxId: row.id, topicId: row.topicId, command: row.command, messageId: row.messageId })
        await topicRepository.markTopicOutboxDispatched(row.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Topic queue dispatch failed'
        const delay = Math.min(60_000, 1_000 * 2 ** row.attempts)
        await topicRepository.deferTopicOutbox(row.id, message, new Date(Date.now() + delay))
      }
    }
    } finally { dispatching = false }
  }
  // Timers only relay durable commands; network/ingestion work is consumed through RabbitMQ.
  await rabbitQueue.work(refreshQueueName, async () => {
    const result = await refreshActiveSources(prisma)
    if (result.failed) throw new Error(`${result.failed} kaynak yenilenemedi.`)
  })
  const refresh = () => rabbitQueue.send(refreshQueueName, {}, { singletonKey: `refresh:${Math.floor(Date.now() / (6 * 60 * 60_000))}` })
  await refresh()
  setInterval(() => void refresh().catch(error => console.error('Source refresh dispatch failed:', error)), 6 * 60 * 60_000)
  await prisma.sourceScanRun.updateMany({ where: { scanRunId: null, status: 'RUNNING', queueDispatchedAt: null }, data: { status: 'QUEUED' } })
  await rabbitQueue.work(sourceQueueName, async jobs => {
    for (const job of jobs) {
      const command = job.data as { runId: string; version: number }
      const run = await prisma.sourceScanRun.findUniqueOrThrow({ where: { id: command.runId } })
      await withJobActor(prisma, run, 'scan.run', () => withUsageContext({conversationId:run.id,conversationType:run.initiatorUserId?'OPERATION':'AUTOMATION',mode:'SCAN',usageLabel:'Kaynak taraması ve rapor üretimi'}, () => executeSourceCommand(prisma, command, job.retryCount, sourceProcessing)))
    }
  })
  await rabbitQueue.work(connectorQueueName, async jobs => {
    for (const job of jobs) await executeConnectorTest(prisma, String(job.data.profileId))
  })
  let sourceDispatching = false
  const dispatchSources = async () => {
    if (sourceDispatching) return
    sourceDispatching = true
    await dispatchConnectorTests(prisma, rabbitQueue).catch(error => console.error('Connector dispatch failed:', error))
    try {
      await dispatchSourceRuns(prisma, rabbitQueue)
    } finally { sourceDispatching = false }
  }
  await dispatchSources()
  setInterval(() => void dispatchSources().catch(error => console.error('Source dispatch failed:', error)), 5000)

  // Drain legacy pg-boss work during upgrades; new outbox publications go directly to RabbitMQ.
  for (const name of [manualScanQueueName, topicAnalysisQueueName]) await queue.work(name, { includeMetadata: true }, async jobs => {
    for (const job of jobs) await rabbitQueue.send(name, { ...(job.data as object), resumeStalled: job.retryCount > 0 }, { singletonKey: (job.data as { outboxId?: string }).outboxId ?? job.id })
  })
  await dispatch()
  setInterval(() => void dispatch().catch((error) => console.error('Outbox dispatch error:', error)), 1_000)

  // Retire fixed schedules, including queued firings left over from older workers.
  await rabbitQueue.work(scheduledScanQueueName, async () => {})
  await queue.work(scheduledScanQueueName, async () => {})

  for (const name of [workspaceAutomationQueue]) {
    if (name === workspaceAutomationQueue) await queue.createQueue(name, { retryLimit: 2 })
    await queue.work(name, { includeMetadata: true }, async jobs => {
      for (const job of jobs) await rabbitQueue.send(name, { ...(job.data as object), scheduledAt: job.createdOn.toISOString() }, { singletonKey: job.id })
    })
  }
  await queue.createQueue(workspaceAutomationQueue, { retryLimit: 2 })
  await reconcileAutomationSchedules(prisma, queue)
  setInterval(() => void reconcileAutomationSchedules(prisma, queue).catch(error => console.error('Automation schedule reconciliation failed:', error)), 30_000)
  await rabbitQueue.work(workspaceAutomationQueue, async jobs => {
    for (const job of Array.isArray(jobs) ? jobs : [jobs]) {
      await executeAutomationCommand(prisma, job.data as { automationId: string; scheduledAt: string; version?: number })
    }
  })

  await rabbitQueue.work(manualScanQueueName, async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs]
    for (const job of jobList) {
      const command = job.data as ScanCommand & { resumeStalled?: boolean }
      const initiator = await prisma.scanOutbox.findUniqueOrThrow({ where: { id: command.outboxId } })
      const usageRun = await prisma.scanRun.findUniqueOrThrow({where:{id:command.runId}})
      await withJobActor(prisma, initiator, 'scan.run', () => withUsageContext({conversationId:command.runId,conversationType:usageRun.automationId || !initiator.initiatorUserId ? 'AUTOMATION':'OPERATION',mode:'ANALYSIS',usageLabel:((usageRun.workspaceConfig as any)?.automationName ?? 'Mevzuat taraması')+' · Rapor üretimi'}, () => executeScanCommand(prisma, command, job.retryCount, async resumeStalled => {
      await executeScanRun(command.runId, {
        repository,
        http,
        objectStore,
        maxRunBytes: BigInt(env.maxRunBytes),
        aiModel,
        previousSourceSearch,
        ...(tariffLookup ? { tariffLookup } : {}),
        topicRepository,
        gemini: {
          model: env.gemini.model,
          maxAttempts: env.gemini.maxAttempts,
          maxContentBytes: env.gemini.maxContentBytes,
          previousSourceConcurrency: env.gemini.previousSourceConcurrency,
          topicConcurrency: env.gemini.topicConcurrency,
        },
      }, command.type, { resumeStalled })
      }, (client, runId) => runSelectedSources(client, runId, sourceProcessing))))
    }
  })

  await rabbitQueue.work(topicAnalysisQueueName, async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs]
    for (const job of jobList) {
      const command = job.data as TopicAnalysisCommand
      const initiator = await prisma.topicOutbox.findUniqueOrThrow({ where: { id: command.outboxId } })
      const usageReport = await prisma.topicReport.findFirst({where:{topicId:command.topicId},select:{id:true}})
      await withJobActor(prisma, initiator, 'report.edit', () => withUsageContext({conversationId:usageReport?.id ?? command.topicId,conversationType:command.messageId?'REPORT':'OPERATION',...(command.messageId?{messageId:command.messageId}:{}),mode:command.messageId?'REVISION':'ANALYSIS',usageLabel:'Rapor analizi'}, async () => {
      if (command.command === 'REVISE_FIELDS') {
        if (!command.messageId) throw new Error('Alan revizyonu komutunda messageId eksik.')
        await executePromptPatch({ topicId: command.topicId, messageId: command.messageId }, {
          repository: topicRepository, draftRepository, objectStore, aiModel,
          model: env.gemini.model, maxAttempts: env.gemini.maxAttempts,
        })
      } else if (command.command === 'RETRY_ANALYSIS') {
        await retryTopicAnalysis(command.topicId, {
          repository: topicRepository, scanRepository: repository, objectStore, aiModel, model: env.gemini.model, ...(tariffLookup ? { tariffLookup } : {}),
          maxAttempts: env.gemini.maxAttempts, maxContextBytes: env.gemini.maxContentBytes,
        })
      } else {
        if (!command.messageId) throw new Error('Revizyon komutunda messageId eksik.')
        await executeTopicRevision({ topicId: command.topicId, messageId: command.messageId }, {
          repository: topicRepository, draftRepository, objectStore, aiModel,
          model: env.gemini.model, maxContextBytes: env.gemini.maxContentBytes,
        })
      }
      }))
    }
  })
}

function createAiModel(timeoutMs: number): AiModelClient {
  const client = createGoogleAi()
  if (!client) {
    return {
      async generateStructured() {
        throw new AiProviderError('AUTHENTICATION', false, 'AI bağlantısı yapılandırılmamış.')
      },
    }
  }
  const transport: GeminiTransport = {
    async generateContent(request) {
      const response = await client.models.generateContent(request)
      return {
        ...(response.text ? { text: response.text } : {}),
        ...(response.responseId ? { responseId: response.responseId } : {}),
        ...(response.usageMetadata ? {usageMetadata: response.usageMetadata} : {}),
      }
    },
  }
  return backgroundUsageModel(new GeminiAiModelClient(transport, { timeoutMs }), new PrismaUsageRecorder(prisma), {conversationType:'OPERATION',mode:'ANALYSIS',usageLabel:'AI analizi'})
}

workerServiceActor(prisma).then(actor => runWithActorContext(actor, startWorker)).catch(err => {
  console.error('Worker başlatılırken hata oluştu:', err)
  process.exit(1)
})
