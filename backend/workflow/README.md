# İş akışı altyapısı

Tarama, analiz, rapor üretimi ve şablon stüdyosunun backend çalışma alanı.
Ana uygulama `backend/src/worker.ts` ve `backend/src/server.ts` üzerinden bu
modülleri süreç içinde çalıştırır. Kullanıcı arayüzü kökteki `frontend/` içindedir.

## Sorumluluklar

| Dizin | Görev |
|---|---|
| `packages/contracts` | İş akışı ve rapor veri sözleşmeleri |
| `packages/engine` | İş planlama, adım durumları, yeniden deneme ve kilitler |
| `packages/steps` | Belge bulma, süzme, indirme, analiz ve rapor adımları |
| `packages/modules` | Resmî Gazete, Tariff ve şablon alan kuralları |
| `packages/platform` | Veritabanı, kuyruk, dosya deposu ve AI bağlantıları |
| `apps/worker` | Ana worker'a gömülen iş akışı çalışma zamanı |
| `apps/studio` | Ana API'ye gömülen şablon stüdyosu |
| `apps/relay`, `apps/scheduler` | Bağımsız geliştirme araçları; yerel uygulama ayrı scheduler başlatmaz |
| `config` | İş akışı tarifleri, kaynaklar, istemler ve rapor teması |
| `infra` | Ayrı geliştirme/test ortamı yardımcıları |

Ana uygulamayla sınır `backend/src/modules/scan-pipeline` katmanıdır. Bu katman
kullanıcı ve çalışma alanı sahipliğini korur, iş akışı sonuçlarını mevcut tarama
ve rapor kayıtlarına aktarır. `backend/src/platform/studio-transport.ts` aynı
uygulama oturumu arkasındaki gömülü stüdyoya erişir.

## Geliştirme ve doğrulama

Bu dizinde `pnpm install --frozen-lockfile`, `pnpm typecheck` ve `pnpm test`
çalıştırılır. Ana `backend/` dizininden eşdeğer komutlar `npm run workflow:install`,
`npm run workflow:check` ve `npm run workflow:test` şeklindedir. Ana backend test
paketi yalnız `backend/test` dizinini, iş akışı test paketi kendi testlerini çalıştırır.

Entegrasyon testleri yalnız adı `_test` ile biten veritabanı ve `-test` ile biten
RabbitMQ sanal sunucusunda çalışır. Test bağlantıları `TEST_DATABASE_URL`,
`TEST_AMQP_URL`, `RABBITMQ_MANAGEMENT_URL`, `TEST_S3_ENDPOINT` ve `TEST_S3_BUCKET`
ile sağlanır. Canlı veritabanında test/migration çalıştırılmaz.

Bağımsız geliştirici araçları: `pnpm worker`, `pnpm relay`, `pnpm studio`,
`pnpm run-once --recipe rg-daily-profile --date YYYY-MM-DD`.
Bunlar normal yerel uygulama kurulumu için gerekmez. Normal başlatma proje
kökündeki `deploy/run-local.mjs` üzerinden yapılır.

## Veri uyumluluğu

Kaynak klasörü eski `v2/` konumundan taşınmıştır. Kalıcı `engine: "v2"` değerleri,
`/api/v2` adresleri, `V2_AMQP_URL`, mevcut veritabanı/kuyruk adları ve nesne deposu
anahtarları geriye uyumluluk için korunur. Bunlar kaynak kod mimarisinin adı değildir.
Bu taşıma migration, veri kopyalama veya sıfırlama gerektirmez. Geliştirme Docker
Compose proje/volume kimlikleri de mevcut verilerin yeniden kullanılabilmesi için korunur.

İş akışı paketi kendi pnpm bağımlılıklarını ve TypeScript ayarlarını korur; ana
backend npm/Prisma kullanır, iş akışı altyapısı Drizzle kullanır. Bu sınır veri
şemalarını karıştırmadan backend altında açıkça tanımlanmıştır.
