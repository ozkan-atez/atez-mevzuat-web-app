import { buildApp } from './app'
import { loadEnv } from './config/env'
import { prisma } from './platform/database'
import { S3ObjectStore } from './modules/scan-runs/infrastructure/s3-object-store'
import { GotenbergPdfRenderer } from './modules/delivery/infrastructure/gotenberg-pdf-renderer'
import { GraphMailSender } from './modules/delivery/infrastructure/graph-mail-sender'

async function start() {
  const env = loadEnv()
  const objectStore = new S3ObjectStore(env.s3)
  const app = await buildApp({
    objectStore,
    timezone: env.timezone,
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

start()
