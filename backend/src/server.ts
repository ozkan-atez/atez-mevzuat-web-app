import { buildApp } from './app'
import { loadEnv } from './config/env'
import { prisma } from './platform/database'
import { S3ObjectStore } from './modules/scan-runs/infrastructure/s3-object-store'
import { GotenbergPdfRenderer } from './modules/delivery/infrastructure/gotenberg-pdf-renderer'
import { GraphMailSender } from './modules/delivery/infrastructure/graph-mail-sender'
import { GoogleGenAI } from '@google/genai'
import { GeminiChatModelClient, UnavailableChatModelClient, type GeminiChatChunk } from './modules/chat/infrastructure/gemini-chat-model-client'
import type { ChatModelClient } from './modules/chat/application/chat-model-client'
import { GeminiAiModelClient, type GeminiTransport } from './modules/ai/infrastructure/gemini-ai-model-client'
import type { AiModelClient } from './modules/ai/application/ai-model-client'
import { CachedOfficialLookup } from './modules/chat/infrastructure/official-document-lookup'

async function start() {
  const env = loadEnv()
  const objectStore = new S3ObjectStore(env.s3)
  const app = await buildApp({
    ...(env.corsOrigins ? { corsOrigin: env.corsOrigins } : {}),
    objectStore,
    officialLookup: new CachedOfficialLookup(prisma, objectStore, {
      hosts: env.sourceHosts, delayMs: env.sourceDelayMs, timeoutMs: env.sourceTimeoutMs,
      maxAttempts: env.sourceMaxAttempts, maxFileBytes: Math.min(env.maxFileBytes, 8_000_000),
    }),
    timezone: env.timezone,
    chatModel: createChatModel(env.gemini.apiKey, env.gemini.timeoutMs),
    chatModelName: env.gemini.model,
    ...(env.gemini.apiKey ? { reportPatchModel: createReportPatchModel(env.gemini.apiKey, env.gemini.timeoutMs), reportPatchModelName: env.gemini.model } : {}),
    pdfRenderer: new GotenbergPdfRenderer({ url: env.gotenberg.url, timeoutMs: env.gotenberg.timeoutMs }),
    mailSender: new GraphMailSender(env.graph),
    mailSenderIdentity: { address: env.graph.senderAddress, name: env.graph.senderName },
    healthChecks: {
      database: async () => { await prisma.$queryRawUnsafe('SELECT 1') },
      queue: async () => {
        const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string | null }>>(
          "SELECT to_regclass('pgboss.job')::text AS table_name",
        )
        if (!rows[0]?.table_name) throw new Error('Queue schema is not ready')
      },
      objectStore: async () => { await objectStore.ensureBucket() },
    },
  })

  try {
    await objectStore.ensureBucket()
    await app.listen({ port: env.port, host: '0.0.0.0' })
    console.log(`🚀 Server listening on http://0.0.0.0:${env.port}`)
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

function createReportPatchModel(apiKey: string, timeoutMs: number): AiModelClient {
  const client = new GoogleGenAI({ apiKey })
  const transport: GeminiTransport = { generateContent: (request) => client.models.generateContent(request as never) as never }
  return new GeminiAiModelClient(transport, { timeoutMs })
}

start()
