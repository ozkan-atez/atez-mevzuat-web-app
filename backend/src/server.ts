import { GeminiBrowserResearch } from './modules/chat/infrastructure/gemini-browser-research'
import { GeminiAiModelClient } from './modules/ai/infrastructure/gemini-ai-model-client'
import { operationQueueName } from './platform/rabbitmq'
import { rabbitQueue } from './platform/rabbitmq'
import { buildApp } from './app'
import { loadEnv } from './config/env'
import { prisma } from './platform/database'
import { S3ObjectStore } from './modules/scan-runs/infrastructure/s3-object-store'
import { GotenbergPdfRenderer } from './modules/delivery/infrastructure/gotenberg-pdf-renderer'
import { GraphMailSender } from './modules/delivery/infrastructure/graph-mail-sender'
import { GoogleGenAI } from '@google/genai'
import { GeminiChatModelClient, UnavailableChatModelClient, type GeminiChatChunk } from './modules/chat/infrastructure/gemini-chat-model-client'
import type { ChatModelClient } from './modules/chat/application/chat-model-client'
import { tariffCredentialsFromEnv } from './modules/managed-sources/tariff-auth'
import { SingleWindowTariffLookup } from './modules/tariff/tariff-lookup'

async function start() {
  const env = loadEnv()
  const objectStore = new S3ObjectStore(env.s3)
  const tariffCredentials = tariffCredentialsFromEnv()
  const app = await buildApp({
    objectStore,
    documentStore: objectStore,
    timezone: env.timezone,
    chatModel: createChatModel(env.gemini.apiKey, env.gemini.timeoutMs),
    chatModelName: env.gemini.model,
    ...(env.gemini.apiKey?{browserResearch:new GeminiBrowserResearch(new GoogleGenAI({apiKey:env.gemini.apiKey}),process.env.GEMINI_BROWSER_MODEL ?? env.gemini.model)}:{}),
    ...(env.gemini.apiKey ? {revisionModel: new GeminiAiModelClient({generateContent: async request => {
      const response = await new GoogleGenAI({apiKey:env.gemini.apiKey!}).models.generateContent(request)
      return {...(response.text ? {text:response.text} : {}),...(response.responseId ? {responseId:response.responseId} : {}),...(response.usageMetadata ? {usageMetadata:response.usageMetadata} : {})}
    }}, {timeoutMs:env.gemini.timeoutMs})} : {}),
    ...(tariffCredentials ? { tariffLookup: new SingleWindowTariffLookup(tariffCredentials) } : {}),
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

function createChatModel(apiKey: string | undefined, timeoutMs: number): ChatModelClient {
  if (!apiKey) return new UnavailableChatModelClient('Gemini API anahtarı yapılandırılmamış.')
  const client = new GoogleGenAI({ apiKey })
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
