import { assertTestDatabaseUrl } from '../packages/platform/src/db/client'

/**
 * Ek B.3 madde 12: entegrasyon testleri yalnızca adı `_test` ile biten veritabanında çalışır.
 * Koşul sağlanmazsa test süreci hiç başlamaz.
 */
export default function setup(): void {
  assertTestDatabaseUrl(process.env.TEST_DATABASE_URL)
  const vhost = decodeURIComponent(new URL(process.env.TEST_AMQP_URL ?? 'amqp://x/').pathname.slice(1))
  if (!vhost.endsWith('-test')) throw new Error(`Güvenlik: entegrasyon testleri yalnızca "-test" vhost'ta çalışır (verilen: "${vhost}")`)
}
