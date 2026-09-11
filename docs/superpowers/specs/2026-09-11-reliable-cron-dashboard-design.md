# Güvenilir Cron ve Canlı Dashboard Tasarımı

**Tarih:** 11 Eylül 2026  
**Durum:** Onaylandı  
**Kapsam:** Dört günlük Resmî Gazete tarama slotu, kalıcı kuyruk aktarımı, worker ayrımı, cron API'si ve dashboard zaman çizelgesi

## Amaç

Uygulama her gün `Europe/Istanbul` saat diliminde 04:00, 09:00, 14:00 ve 22:00 taramalarını güvenilir, tekilleştirilmiş ve gözlemlenebilir biçimde çalıştırır. API prosesi uzun işleri yürütmez; scheduler bir `WorkflowRun` oluşturur ve işi pg-boss kuyruğuna aktarır. Dashboard yalnız gerçek çalıştırma kayıtlarından türetilen slot durumlarını gösterir.

## Kesin iş kuralları

- Scheduler ve yayın tarihi için tek saat dilimi `Europe/Istanbul` olur.
- 04:00 slotu `FULL`, diğer üç slot `MUKERRER_CHECK` modundadır.
- `FULL` standart günlük sayıyı ve yayımlanmış mükerrerleri işler.
- `MUKERRER_CHECK` yalnız mükerrer yayınları keşfeder; standart günlük sayıyı yeniden işlemez.
- Aynı hedef tarih ve slot için en fazla bir zamanlanmış run oluşturulur.
- Manuel tetikleme seçilen slotla ilişkilendirilir fakat zamanlanmış run'ın benzersiz anahtarını tüketmez.
- Cron kökenli akış otomatik e-posta göndermez. Raporlardan düzenlenebilir bir mail taslağı üretir; gönderim yalnız yetkili admin komutuyla yapılır.
- Kuyruğa aktarım başarısızlığı başarılı `202` yanıtı olarak gösterilmez ve run süresiz `PENDING` bırakılmaz.
- Run durumu olarak `PENDING` kuyrukta bekleyen, `RUNNING` aktif çalışan, `COMPLETED` başarıyla biten, `FAILED` başarısız çalışma anlamına gelir. Run'ı olmayan UI slotlarında zamanı gelmemiş slot `PENDING`, zamanı geçtiği halde çalışmamış slot `WAITING` olarak gösterilir; ikisi de aktif tarama sayılmaz.

## Proses mimarisi

- `server.ts` yalnız Fastify uygulamasını ve kısa HTTP isteklerini çalıştırır.
- `worker.ts` pg-boss consumer'ı çalıştırır.
- Scheduler worker prosesinde başlatılır; üretimde API ve worker aynı backend imajından farklı komutlarla çalışan ayrı servislerdir.
- Birden fazla worker prosesinin aynı cron tick'ini görmesi güvenlidir; veritabanı benzersiz anahtarı ikinci zamanlanmış run'ı engeller.
- Worker başlangıcında bugünün geçmiş fakat kaydı olmayan slotları için en fazla bir telafi taraması oluşturulur. Eski slotların tamamı ayrı ayrı yığılmaz; en son kaçırılan slotun kapsamıyla tek telafi işi açılır.

## Modül sınırları

`modules/cron` aşağıdaki sorumluluklara ayrılır:

- `cron.definitions.ts`: slot tanımları ve saf zaman/slot hesapları.
- `cron.repository.ts`: `WorkflowRun` ve outbox kalıcılığı, slot sorguları ve benzersizlik davranışı.
- `cron.service.ts`: zamanlanmış/manüel tetikleme ile dashboard kullanım senaryoları; Fastify tiplerini bilmez.
- `cron.scheduler.ts`: node-cron kayıtları ve başlangıç telafisi.
- `cron.schemas.ts`: HTTP istek/yanıt doğrulama şemaları.
- `cron.routes.ts`: kimlik/yetki kontrolü, şema doğrulama ve servis çağrısı.

Servisler Prisma, pg-boss veya global singleton oluşturmaz. Gerçek bağımlılıklar bootstrap aşamasında kurulur. Kuyruk, saat ve repository dar arayüzler üzerinden enjekte edilir.

## Kalıcı veri modeli

`WorkflowRun` geriye dönük `parameters` alanını korur ve aşağıdaki sorgulanabilir alanları ekler:

- `targetDate`: `YYYY-MM-DD` yayın tarihi.
- `mode`: `FULL | MUKERRER_CHECK`.
- `triggerSource`: `SCHEDULED | MANUAL | CATCH_UP`.
- `slotTime`: `04:00 | 09:00 | 14:00 | 22:00`.
- `scheduleKey`: yalnız zamanlanmış/telafi işleri için benzersiz anahtar.
- `queuedAt`: pg-boss'a başarıyla aktarıldığı zaman.

`WorkflowOutbox` run ile bire bir ilişkilidir ve kuyruk adı, payload, durum, deneme sayısı, son hata ve işlenme zamanını tutar. Run ve outbox aynı Prisma transaction'ında oluşturulur. Outbox dispatcher kaydı pg-boss'a idempotent anahtarla gönderir; başarıda outbox'ı ve `queuedAt` alanını günceller. Kalıcı hatada run `FAILED` olur. Yeniden başlatma, bekleyen outbox kayıtlarını tekrar işler.

Mevcut JSON `parameters` okumaları geçiş boyunca fallback olarak desteklenir; yeni yazımlar yapılandırılmış sütunları ve uyumluluk JSON'unu birlikte doldurur.

## Çalıştırma akışı

1. Scheduler İstanbul tarihini ve slotun planlanan UTC anını hesaplar.
2. Cron servisi `scheduleKey` ile zamanlanmış run ve outbox kaydını atomik oluşturur.
3. Outbox dispatcher işi `workflow-run` kuyruğuna aktarır.
4. Worker run'ı `RUNNING` yapar ve mevcut structured alanları silmeden workflow'u yürütür.
5. Scraper `FULL` için günlük+mükerrer, `MUKERRER_CHECK` için yalnız mükerrer metodunu çağırır.
6. Analiz ve rapor üretimi tamamlanır.
7. Cron kökenli run için mail taslağı oluşturulur; mail gönderilmez.
8. Run `COMPLETED` veya `FAILED` olarak sonlandırılır.

## API sözleşmesi

### `GET /api/cron/status`

Admin kimliği gerektirir. Yanıt İstanbul tarihine göre hazırlanır:

- `targetDate`, `currentTime`, `timezone`
- `completedSlotsCount`, `progressPercent`
- varsa tek `activeScan`
- dört slot için `time`, `title`, `mode`, `status`, `runId`, zamanlar, özet ve sayaçlar

Run'ı olmayan gelecek slot `PENDING`, zamanı geçmiş slot `WAITING` döner. İlgisiz manuel veya eski tarihli run hiçbir slota fallback olarak bağlanmaz. Bir slotta birden fazla manuel deneme varsa en son çalışma gösterilir; zamanlanmış çalışma mevcutsa önceliklidir.

### `POST /api/cron/trigger`

Admin kimliği ve CSRF koruması gerektirir. Gövde yalnız tanımlı `slotTime` ve isteğe bağlı geçerli `YYYY-MM-DD targetDate` kabul eder. Mode istemciden güven kaynağı olarak alınmaz; slot tanımından türetilir. Başarılı atomik kayıt sonrası `202 { runId, slotTime, mode, targetDate }` döner. Aynı idempotency anahtarıyla yinelenen manuel istek aynı run'ı döndürür.

## Dashboard davranışı

- İstekler ortak API istemcisinden kimlik bilgileriyle yapılır.
- İlk yüklemede ve her 5 saniyede status sorgulanır; önceki polling tamamlanmadan yeni istek başlatılmaz.
- Yalnız `RUNNING` slot mavi canlı animasyon gösterir.
- `COMPLETED` yeşil tik ve sonuç bağlantısı gösterir.
- `PENDING` ve `WAITING` bekleme görünümündedir; aktif bir run yoksa “Şimdi Çalıştır” kullanılabilir.
- `FAILED` hata görünümü, detay bağlantısı ve yeniden manuel tetikleme sunar.
- API henüz yanıt vermediyse sahte tamamlanmış/çalışan slot gösterilmez; nötr yükleniyor iskeleti kullanılır.
- İlerleme yüzdesi `completed / 4 * 100` olur; yapay minimum yüzde uygulanmaz.

## Güvenlik ve hata davranışı

- Cron rotaları ortak admin doğrulama hook'u arkasındadır.
- Slot, tarih ve idempotency girdileri şemayla doğrulanır; bilinmeyen değer `400` döndürür.
- Hata yanıtları iç exception mesajını istemciye sızdırmaz; ayrıntı yapılandırılmış logda request ID ile tutulur.
- Scheduler callback hataları yakalanıp loglanır; unhandled promise rejection oluşturmaz.
- Graceful shutdown cron görevlerini durdurur, outbox dispatcher'ı ve pg-boss bağlantısını kapatır.

## Dağıtım

Production Compose iki backend servisi çalıştırır:

- `backend-api`: API komutu, scheduler ve consumer kapalı.
- `backend-worker`: worker komutu, pg-boss consumer ve scheduler açık.

Şema değişiklikleri container başlangıcında `db push --accept-data-loss` ile yapılmaz. Prisma migration release adımında tek kez uygulanır. Her iki proses aynı sabit imajı kullanır.

## Test stratejisi ve kabul ölçütleri

- Saf zaman testleri gece yarısı, İstanbul/UTC tarih farkı ve dört slot sınırını kapsar.
- Repository/service testleri yanlış tarih fallback'ini, manuel slot eşleşmesini, duplicate schedule key'i ve outbox hata durumunu kapsar.
- Runner testi `MUKERRER_CHECK` modunda standart günlük scraper'ın çağrılmadığını doğrular.
- Cron kökenli runner testi mail sender'ın çağrılmadığını ve taslak oluşturulduğunu doğrular.
- Fastify injection testleri status/trigger doğrulamasını ve yetkisiz erişimi kapsar.
- Frontend testleri PENDING/WAITING/RUNNING/COMPLETED/FAILED görünümlerini ve düğme durumlarını kapsar.
- Backend test, typecheck/build; frontend test, lint ve build başarılı olmalıdır.
- Canlı doğrulamada geçmiş tarihli manuel run bugünün 04:00 slotuna bağlanmamalı; gelecekteki slotlar “İşleniyor” görünmemelidir.

## Kapsam dışı

- Gerçek kurumsal OIDC sağlayıcısının kurulması bu değişikliğin parçası değildir; mevcut kimlik katmanında yeniden kullanılabilir admin koruması uygulanır.
- Bağımsız belge arşivi/S3 geçişi ve tüm rapor veri modelinin yeniden tasarımı bu cron düzeltmesinin parçası değildir.
- Cron saatlerini kullanıcı arayüzünden düzenleme sonraki aşamadır.
