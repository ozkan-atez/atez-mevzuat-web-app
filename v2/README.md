# ATEZ Mevzuat Radarı — v2

Hedef mimarinin (`docs/architecture/2026-10-15-hedef-mimari.md`) uygulaması. Eski sistem
(`backend/`, `frontend/`) dokunulmadan çalışmaya devam eder; geçiş sonra yapılacak.

## Yapı (§13)

```text
apps/       api · worker · scheduler · relay · web
packages/   contracts · engine · steps · modules · platform
config/     recipes · sources · keyword-sets · templates · prompts · ai.json · schedules.json
infra/      yerel docker-compose yardımcıları, RabbitMQ definitions JSON
```

## Yerel geliştirme

```bash
cp .env.example .env
pnpm install
pnpm infra:up          # postgres :55432, rabbitmq :55672 (yönetim :55673), minio :55900
pnpm db:migrate
pnpm worker            # --pool=all: bütün havuzlar + orkestratör + reaper
pnpm relay             # outbox → RabbitMQ
pnpm api               # :3100  POST /runs  GET /runs/:id · /api/components · /api/templates
pnpm web               # :5174  Bileşen havuzu + şablon stüdyosu (Vite, /api proxy)
```

## Tek seferlik çalıştırma (geliştirici aracı)

```bash
# .env: GOOGLE_APPLICATION_CREDENTIALS (servis hesabı anahtarı), VERTEX_LOCATION (varsayılan global)
pnpm run-once --recipe rg-daily-profile --date 2025-12-31
```

Relay + bütün havuzlar + orkestratör tek süreçte açılır; run bitince adım sayaçları, ön kontrol
durumu ve bu run'daki AI çağrısı sayısı basılır. Aynı tarih ikinci kez çalıştırıldığında ön
kontrol `NO_CHANGE` döner ve AI çağrısı yapılmaz.

## Aşama durumu

| Aşama | Durum |
|---|---|
| 1. İskelet | contracts, platform (RabbitMQ topolojisi, outbox/inbox, relay, MinIO, AI geçidi), engine (run/work_item/step_result, lease+heartbeat, reaper, modlar) |
| 3. Önceki hal + analiz + rapor | TARIFF → RG → tek kaynak, kümülatif analiz, kodla karşılaştırma, READY rapor |
| §10.1 Şablon stüdyosu | Bileşen havuzu (yerleşik K1–K6 + AI), şablonlar (bölüm açıklaması → compose), web arayüzü |
| 2. RG çekirdeği | `rg-daily-profile` tarifi: `source.discover` (ön kontrol) → `classify.title` → `doc.fetch` → `doc.normalize` → `classify.profile` |

## Testler

```bash
pnpm typecheck
pnpm test              # unit + integration
```

Entegrasyon testleri yalnızca adı `_test` ile biten veritabanında (`atez_v2_test`) ve `-test`
ile biten RabbitMQ vhost'unda çalışır; koşul sağlanmazsa test süreci başlamaz (Ek B.3 madde 12).

## RabbitMQ

Topoloji koddan idempotent kurulur. Kuyruk açma yetkisi olmayan ortamlar için
`pnpm topology:export <vhost> > definitions.json` çıktısı altyapı ekibine verilir
(`infra/rabbitmq/definitions.json` güncel kopyadır).
