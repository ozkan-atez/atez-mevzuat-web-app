import { startQueue, manualScanQueueName, scheduledScanQueueName, topicAnalysisQueueName } from './platform/queue'
import { prisma } from './platform/database'
import { loadEnv } from './config/env'
import { PrismaScanRepository } from './modules/scan-runs/infrastructure/prisma-scan-repository'
import { PgBossScanQueue } from './modules/scan-runs/infrastructure/scan-run-queue'
import { S3ObjectStore } from './modules/scan-runs/infrastructure/s3-object-store'
import { OfficialHttpClient } from './modules/scan-runs/infrastructure/official-http-client'
import { SourcePolicy } from './modules/scan-runs/domain/source-policy'
import { executeScanRun } from './modules/scan-runs/application/execute-scan-run'
import { registerScanSchedules, resolveScheduledTargetDate } from './modules/scan-runs/application/register-scan-schedules'
import { findScheduleSlot, type ScanScheduleSlotKey } from './modules/scan-runs/domain/scan-schedule'
import { DateTime } from 'luxon'
import { GoogleGenAI } from '@google/genai'
import type { AiModelClient } from './modules/ai/application/ai-model-client'
import { AiProviderError } from './modules/ai/domain/ai-errors'
import { GeminiAiModelClient, type GeminiTransport } from './modules/ai/infrastructure/gemini-ai-model-client'
import type { ScanCommand } from './modules/scan-runs/application/ports'
import { ResmiGazeteSearch } from './modules/scan-runs/infrastructure/resmi-gazete-search'
import { PrismaTopicAnalysisRepository } from './modules/topic-analysis/infrastructure/prisma-topic-analysis-repository'
import { PgBossTopicAnalysisQueue, type TopicAnalysisCommand } from './modules/topic-analysis/infrastructure/topic-analysis-queue'
import { executeTopicRevision } from './modules/topic-analysis/application/execute-topic-revision'
import { executePromptPatch } from './modules/topic-analysis/application/execute-prompt-patch'
import { PrismaReportDraftRepository } from './modules/topic-analysis/infrastructure/prisma-report-draft-repository'
import { retryTopicAnalysis } from './modules/topic-analysis/application/retry-topic-analysis'

async function startWorker() {
  const queue = await startQueue()
  const env = loadEnv()
  const repository = new PrismaScanRepository(prisma)
  const topicRepository = new PrismaTopicAnalysisRepository(prisma)
  const draftRepository = new PrismaReportDraftRepository(prisma)
  const scanQueue = new PgBossScanQueue(queue)
  const topicQueue = new PgBossTopicAnalysisQueue(queue)
  const objectStore = new S3ObjectStore(env.s3)
  const http = new OfficialHttpClient(new SourcePolicy(env.sourceHosts), {
    delayMs: env.sourceDelayMs,
    timeoutMs: env.sourceTimeoutMs,
    maxAttempts: env.sourceMaxAttempts,
    maxFileBytes: env.maxFileBytes,
  })
  const aiModel = createAiModel(env.gemini.apiKey, env.gemini.timeoutMs)
  const previousSourceSearch = new ResmiGazeteSearch(new SourcePolicy(env.sourceHosts), { timeoutMs: env.sourceTimeoutMs })
  await objectStore.ensureBucket()

  const dispatch = async () => {
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
  }
  await dispatch()
  setInterval(() => void dispatch().catch((error) => console.error('Outbox dispatch error:', error)), 1_000)

  const { registered } = await registerScanSchedules({
    schedule: (name, cron, data, options) => queue.schedule(name, cron, data, options),
    unschedule: (name, cron) => queue.unschedule(name, cron),
    getSchedules: async () => (await queue.getSchedules()).map((schedule) => ({ name: schedule.name, key: schedule.key ?? '' })),
  }, { queueName: scheduledScanQueueName, timezone: env.timezone })
  console.log(`⏰ Günlük tarama zamanlamaları kuruldu (${env.timezone}): ${registered.join(', ')}`)

  await queue.work(scheduledScanQueueName, async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs]
    for (const job of jobList) {
      const { slotKey } = job.data as { slotKey: ScanScheduleSlotKey }
      const slot = findScheduleSlot(slotKey)
      if (!slot) {
        console.error(`Bilinmeyen zamanlama slotu: ${slotKey}`)
        continue
      }
      // The gazette day is the local calendar day, not UTC: the 23:00 Istanbul run
      // must still target that same day, and a recovered firing its own day.
      const now = DateTime.now().setZone(env.timezone)
      const targetDate = resolveScheduledTargetDate({
        slotHour: slot.hour, localHour: now.hour, localDate: now.toFormat('yyyy-MM-dd'),
      })
      const run = await repository.createScheduledRun({ targetDate, slotKey })
      console.log(run.created
        ? `⏰ ${slot.label} taraması oluşturuldu (${targetDate}): ${run.id}`
        : `⏰ ${slot.label} taraması zaten var (${targetDate}): ${run.id}`)
    }
  })

  await queue.work(manualScanQueueName, async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs]
    for (const job of jobList) {
      const command = job.data as ScanCommand
      await executeScanRun(command.runId, {
        repository,
        http,
        objectStore,
        maxRunBytes: BigInt(env.maxRunBytes),
        aiModel,
        previousSourceSearch,
        topicRepository,
        gemini: {
          model: env.gemini.model,
          maxAttempts: env.gemini.maxAttempts,
          maxContentBytes: env.gemini.maxContentBytes,
          previousSourceConcurrency: env.gemini.previousSourceConcurrency,
          topicConcurrency: env.gemini.topicConcurrency,
        },
      }, command.type)
    }
  })

  await queue.work(topicAnalysisQueueName, async (jobs) => {
    const jobList = Array.isArray(jobs) ? jobs : [jobs]
    for (const job of jobList) {
      const command = job.data as TopicAnalysisCommand
      if (command.command === 'REVISE_FIELDS') {
        if (!command.messageId) throw new Error('Alan revizyonu komutunda messageId eksik.')
        await executePromptPatch({ topicId: command.topicId, messageId: command.messageId }, {
          repository: topicRepository, draftRepository, objectStore, aiModel,
          model: env.gemini.model, maxAttempts: env.gemini.maxAttempts,
        })
      } else if (command.command === 'RETRY_ANALYSIS') {
        await retryTopicAnalysis(command.topicId, {
          repository: topicRepository, scanRepository: repository, objectStore, aiModel, model: env.gemini.model,
          maxAttempts: env.gemini.maxAttempts, maxContextBytes: env.gemini.maxContentBytes,
        })
      } else {
        if (!command.messageId) throw new Error('Revizyon komutunda messageId eksik.')
        await executeTopicRevision({ topicId: command.topicId, messageId: command.messageId }, {
          repository: topicRepository, draftRepository, objectStore, aiModel,
          model: env.gemini.model, maxContextBytes: env.gemini.maxContentBytes,
        })
      }
    }
  })
}

function createAiModel(apiKey: string | undefined, timeoutMs: number): AiModelClient {
  if (!apiKey) {
    return {
      async generateStructured() {
        throw new AiProviderError('AUTHENTICATION', false, 'Gemini API anahtarı yapılandırılmamış.')
      },
    }
  }
  const client = new GoogleGenAI({ apiKey })
  const transport: GeminiTransport = {
    async generateContent(request) {
      const response = await client.models.generateContent(request)
      return {
        ...(response.text ? { text: response.text } : {}),
        ...(response.responseId ? { responseId: response.responseId } : {}),
        usageMetadata: {
          ...(typeof response.usageMetadata?.promptTokenCount === 'number' ? { promptTokenCount: response.usageMetadata.promptTokenCount } : {}),
          ...(typeof response.usageMetadata?.candidatesTokenCount === 'number' ? { candidatesTokenCount: response.usageMetadata.candidatesTokenCount } : {}),
        },
      }
    },
  }
  return new GeminiAiModelClient(transport, { timeoutMs })
}

startWorker().catch(err => {
  console.error('Worker başlatılırken hata oluştu:', err)
  process.exit(1)
})
