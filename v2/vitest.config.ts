import { defineConfig } from 'vitest/config'

// Yerel docker-compose varsayılanları; CI'da ortam değişkenleriyle ezilir.
const defaults = {
  TEST_DATABASE_URL: 'postgres://atez:atez-local@127.0.0.1:55432/atez_v2_test',
  TEST_AMQP_URL: 'amqp://atez:atez-local@127.0.0.1:55672/atez-mevzuat-test',
  RABBITMQ_MANAGEMENT_URL: 'http://atez:atez-local@127.0.0.1:55673',
  TEST_S3_ENDPOINT: 'http://127.0.0.1:55900',
  TEST_S3_BUCKET: 'atez-radar-test',
  S3_ACCESS_KEY_ID: 'atez-local',
  S3_SECRET_ACCESS_KEY: 'atez-local-secret',
  LOG_LEVEL: 'error',
}
// globalSetup ana süreçte çalışır; varsayılanlar oraya da görünsün.
for (const [k, v] of Object.entries(defaults)) process.env[k] ??= v
const env = defaults

export default defineConfig({
  test: {
    // Entegrasyon testleri ortak DB/vhost kullanır; dosyalar sırayla çalışır.
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['packages/*/test/**/*.unit.test.ts', 'apps/*/test/**/*.unit.test.ts'], env },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['packages/*/test/**/*.int.test.ts', 'apps/*/test/**/*.int.test.ts'],
          env,
          globalSetup: ['./test/integration-guard.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
