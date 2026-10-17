import { HttpComponentStudio } from './modules/chat/application/component-studio'
import { backgroundUsageModel } from './modules/usage/background-usage'
import { PrismaUsageRecorder } from './modules/usage/prisma-usage-recorder'
import { GeminiAiModelClient } from './modules/ai/infrastructure/gemini-ai-model-client'
import { operationQueueName } from './platform/rabbitmq'
import { rabbitQueue } from './platform/rabbitmq'
import { buildApp } from './app'
import { loadEnv } from './config/env'
import { prisma } from './platform/database'
import { S3ObjectStore } from './modules/scan-runs/infrastructure/s3-object-store'
import { GotenbergPdfRenderer } from './modules/delivery/infrastructure/gotenberg-pdf-renderer'
import { GraphMailSender } from './modules/delivery/infrastructure/graph-mail-sender'
import type { GoogleGenAI } from '@google/genai'
import { createGoogleAi } from './config/google-ai'
import { GeminiChatModelClient, UnavailableChatModelClient, type GeminiChatChunk } from './modules/chat/infrastructure/gemini-chat-model-client'
import type { ChatModelClient } from './modules/chat/application/chat-model-client'
import { tariffCredentialsFromEnv } from './modules/managed-sources/tariff-auth'
import { SingleWindowTariffLookup } from './modules/tariff/tariff-lookup'

async function start() {
  const env = loadEnv()
  const ai = createGoogleAi()
  const objectStore = new S3ObjectStore(env.s3)
  const tariffCredentials = tariffCredentialsFromEnv()
  const app = await buildApp({
    objectStore,
    documentStore: objectStore,
    timezone: env.timezone,
    chatModel: createChatModel(ai, env.gemini.timeoutMs),
    chatModelName: env.gemini.model,
    ...(ai ? {revisionModel: backgroundUsageModel(new GeminiAiModelClient({generateContent: async request => {
      const response = await ai.models.generateContent(request)
      return {...(response.text ? {text:response.text} : {}),...(response.responseId ? {responseId:response.responseId} : {}),...(response.usageMetadata ? {usageMetadata:response.usageMetadata} : {})}
    }}, {timeoutMs:env.gemini.timeoutMs}), new PrismaUsageRecorder(prisma), {conversationType:'TEMPLATE', mode:'TEMPLATE', usageLabel:'Şablon oluşturma / düzenleme'})} : {}),
    ...(tariffCredentials ? { tariffLookup: new SingleWindowTariffLookup(tariffCredentials) } : {}),
    ...(env.componentStudioUrl ? { componentStudio: new HttpComponentStudio({ baseUrl: env.componentStudioUrl }) } : {}),
    pdfRenderer: new GotenbergPdfRenderer({ url: env.gotenberg.url, timeoutMs: env.gotenberg.timeoutMs }),
    mailSender: new GraphMailSender(env.graph),
    mailSenderIdentity: { address: env.graph.senderAddress, name: env.graph.senderName },
    healthChecks: {
      database: async () => { await prisma.$queryRawUnsafe('SELECT 1') },
      queue: async () => {
        const queues = await rabbitQueue.status()
        if (queues.filter(queue => process.env.MODULAR_OPERATIONS_ENABLED === 'true' || queue.name !== operationQueueName).some(queue => queue.consumers === 0)) throw new Error('RabbitMQ worker is unavailable')
      },
      objectStore: async () => { await objectStore.ensureBucket() },
    },
  })

  try {
    await objectStore.ensureBucket()
    await app.listen({ port: env.port, host: process.env.API_HOST ?? '0.0.0.0' })
    console.log(`🚀 Server listening on http://${process.env.API_HOST ?? '0.0.0.0'}:${env.port}`)
  } catch (err) {
    console.error('Error starting server:', err)
    process.exit(1)
  }
}

function createChatModel(client: GoogleGenAI | undefined, timeoutMs: number): ChatModelClient {
  if (!client) return new UnavailableChatModelClient('AI bağlantısı yapılandırılmamış.')
  return new GeminiChatModelClient({
    async generateContentStream(request) {
      const stream = await client.models.generateContentStream(request as never)
      // The chunk is passed through whole: besides the text it carries the raw
      // parts, and the adapter needs those for the thought signature that must
      // travel back with each tool call.
      return stream as unknown as AsyncIterable<GeminiChatChunk>
    },
  }, { timeoutMs })
}

start()
