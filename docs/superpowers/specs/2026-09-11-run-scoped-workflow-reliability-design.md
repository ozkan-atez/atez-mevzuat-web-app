# Run-Bazlı Güvenilir Tarama Akışı Tasarımı

**Tarih:** 11 Eylül 2026  
**Durum:** Kullanıcı tarafından onaylandı  
**Kapsam:** Manuel ve zamanlanmış Resmî Gazete taramalarının aynı güvenilir uygulama akışını kullanması, çalışma geçmişinin değişmez kalması, Gemini yapılandırılmış çıktıları, API DTO sınırı ve frontend durum doğruluğu

## 1. Problem özeti

Canlı incelemede Docker servislerinin çalıştığı, Resmî Gazete fihristinin ve beş temel belgenin indirildiği, metin çıkarma adımlarının tamamlandığı doğrulandı. Görülen arızalar birbirini büyüten dört ayrı sözleşme ihlalinden kaynaklanmaktadır:

- `GET /api/runs/:id` ve belge-pipeline sorguları Prisma modellerini doğrudan JSON'a verdiği için `DocumentArtifact.sizeBytes` alanındaki `BigInt` Fastify serializasyonunu 500 ile düşürür.
- Frontend tüm başarısız detay yanıtlarını 404 gibi ele alıp “Kayıt bulunamadı” gösterir; `FAILED` dahil tamamlanmamış bütün durumları “İnceleniyor” olarak sunar.
- Gemini çağrısında yalnız `responseMimeType: application/json` kullanılır; gerçek çıktı şeması sağlayıcıya verilmez. Geçerli JSON olsa bile alan biçimi Zod sözleşmesine uymadığında sınıflandırma kalıcı hataya düşer.
- `GazetteIssue.issueKey` bütün çalışmalar arasında benzersizdir ve yeniden taramada `runId` yeni çalışmaya taşınır. Belge/adım tekilleştirme anahtarları run içermediği için ikinci çalışma önceki `FAILED_FINAL` adımlarını yeniden kullanır; coordinator bunu “zaten tamamlandı” sayar ve run süresiz `RUNNING` kalır.

Ek olarak dashboard, kaynak türünü sorgulanabilir `triggerSource` alanı yerine eski `parameters.triggeredBy` metninden tahmin ettiği için `MANUAL_CRON_04_00` manuel çalışmasını cron olarak etiketler. Bazı KPI alt kırılımları da sabit metin ve yüzdelerden oluşur.

## 2. Hedefler ve değişmezler

- 04:00, 09:00, 14:00 ve 22:00 zamanlanmış slotları `Europe/Istanbul` saat diliminde çalışır.
- Manuel ve zamanlanmış tetikleyiciler aynı application use case ve kalıcı kuyruk hattına girer; yalnız tetik kaynağı ve slot politikası farklıdır.
- Her `WorkflowRun` değişmez bir yürütme geçmişidir. Sonraki bir tarama önceki run'ın issue, adım, değerlendirme veya rapor sahipliğini değiştiremez.
- Aynı run ve aynı girdi/sürüm tekrar teslim edildiğinde iş idempotenttir. Farklı run, aynı belgeyi bağımsız olarak değerlendirebilir.
- Kaynak dosya byte'ları içerik hash'iyle fiziksel olarak tekrar kullanılabilir; yürütme kayıtları ve iş kararları paylaşılmaz.
- Bir adım kalıcı olarak hata verdiğinde belge ve sonuçta run terminal duruma ulaşır; hiçbir run sınırsız `RUNNING` kalmaz.
- Gemini yalnız sağlayıcıya tanımlanmış JSON şemasıyla çağrılır. Dönen veri ayrıca Zod ile doğrulanır; serbest metin, dizi veya eksik alan iş sonucu olarak kaydedilmez.
- API katmanı Prisma varlıklarını doğrudan dışarı vermez. JSON-güvenli, sürümlenebilir DTO'lar kullanır.
- Frontend 404, 500, ağ hatası, boş pipeline, aktif çalışma ve terminal hata durumlarını birbirinden ayırır.
- Üretim kaynak veya model hatası mock/fallback mevzuat ya da rapor oluşturamaz.

## 3. Önerilen veri modeli

### 3.1 Kanonik yayın ve run yürütmesi

`GazetteIssue`, Resmî Gazete yayınının kanonik kimliğini temsil etmeye devam eder:

- `issueKey = publicationDate:issueNumber:variant`
- yayın tarihi, sayı, varyant ve kaynak URL
- kanonik belge tanımları ve indirilen içerik artefaktları

Run sahipliği `GazetteIssue.runId` üzerinden tutulmaz. Bunun yerine yeni `RunIssueExecution` varlığı kullanılır:

- `id`
- `runId`
- `issueId`
- `status`
- `startedAt`, `finishedAt`
- `summary`, `error`
- benzersizlik: `(runId, issueId)`

Bu ayrım aynı yayının birden fazla manuel veya zamanlanmış çalışmada güvenle kullanılmasını sağlar. `WorkflowRun -> RunIssueExecution -> GazetteIssue` ilişkisi geçmişi korur.

### 3.2 Run-bazlı belge yürütmesi

Kanonik `SourceDocument`, kaynağın kimliğini ve içerik paketini tutar. Yeni `RunDocumentExecution` her run'daki iş kararını tutar:

- `id`
- `runIssueExecutionId`
- `documentId`
- `status`
- o çalışmada kullanılan `inputHash`
- son değerlendirme/rapor ilişkileri
- benzersizlik: `(runIssueExecutionId, documentId)`

`WorkflowStepExecution` doğrudan `runDocumentExecutionId` ile ilişkilendirilir. Adım idempotency anahtarı:

```text
{runId}:{runDocumentExecutionId}:{step}:{inputHash}:{version}
```

Kanonik artefakt anahtarları içerik hash'i üzerinden tekrar kullanılabilir. Assessment, rapor ve mail taslağı run yürütmesine aittir; önceki run'ın kararları yeni run'a taşınmaz.

### 3.3 Geçiş

Migrasyon yalnız eklemeli olacaktır:

1. Yeni yürütme tabloları ve nullable ilişkiler eklenir.
2. Mevcut `GazetteIssue.runId` verisinden `RunIssueExecution` kayıtları backfill edilir.
3. Mevcut belge/adım kayıtları uygun run yürütmesine bağlanır.
4. Uygulama yeni modeli okumaya/yazmaya geçtikten sonra eski `GazetteIssue.runId` yalnız uyumluluk alanı olarak bırakılır; bu çalışma kapsamında veri silinmez.

## 4. Tek girişli application akışı

Hem `POST /api/jobs/run` hem `POST /api/cron/trigger` ve scheduler aşağıdaki tek kullanım senaryosunu çağırır:

```text
StartWorkflowRun(command)
  -> run + outbox transaction
  -> workflow-run queue
  -> StartRunExecution
  -> issue.discover
  -> kanonik issue/documents upsert
  -> run issue/document execution kayıtları oluştur
  -> document.acquire
  -> document.extract
  -> document.classify
  -> IN: previous -> report -> render -> draft -> finalize
  -> OUT/UNCERTAIN: finalize
  -> run durumunu bütün run-document yürütmelerinden hesapla
```

Scheduler doğrudan belge hattını çağırmaz. Manuel istek de API prosesinde uzun iş çalıştırmaz. Her ikisi aynı outbox ve pg-boss davranışına sahiptir.

## 5. Durum ve hata politikası

### 5.1 Terminal durumlar

- Bütün belgeler başarılı/harici/inceleme-gerekli terminal durumdaysa run `COMPLETED` olur.
- En az bir belge `FAILED_FINAL` ise run `COMPLETED_WITH_ERRORS` olur. Mevcut üst seviye API uyumluluğu için bu değer desteklenemiyorsa `FAILED` kullanılır; dashboard bunu başarı olarak göstermez.
- Issue keşfi hiç yapılamazsa run `FAILED` olur.
- Aktif veya yeniden denenebilir adım varsa run terminal değildir.

Finalizasyon tek bir `RecalculateRunStatus` use case'inde, transaction içinde ve idempotent uygulanır. Belge hata handler'ı da terminal hata sonrası bu use case'i tetikler.

### 5.2 Claim/retry davranışı

`claimStep` üç anlamlı sonuç döndürür:

- `CLAIMED`: iş bu worker tarafından çalıştırılacaktır.
- `ALREADY_COMPLETED`: yalnız gerçekten `COMPLETED` adım için.
- `IN_PROGRESS`: başka worker'ın geçerli kirası vardır.

`FAILED_FINAL` hiçbir zaman `ALREADY_COMPLETED` sayılmaz. Manuel retry yeni bir `version` üretir. Süresi dolmuş `RUNNING` claim lease ile yeniden alınabilir. Kuyruk retry sayısı ile veritabanı `attempts` alanı aynı terminal politikasına bağlanır.

## 6. Gemini yapılandırılmış çıktı sözleşmesi

AI gateway genel `unknown` döndüren bir API yerine şema taşıyan bir çağrı sunar:

```ts
generateStructured<T>(input: {
  prompt: string;
  systemInstruction: string;
  files: GeminiFileInput[];
  responseSchema: GeminiResponseSchema;
  parse: (value: unknown) => T;
}): Promise<T>
```

Sınıflandırma çağrısı sağlayıcının `generationConfig.responseSchema` alanına şu zorunlu yapıyı verir:

- `decision`: `IN | OUT | UNCERTAIN`
- `confidence`: 0 ile 1 arasında sayı
- `reason`: metin
- `matchedTopics`: metin dizisi
- `evidence`: en az bir `{ artifactId, page, quote }` nesnesi

Rapor analizi için `reportAnalysisSchema` ile eşdeğer ayrı sağlayıcı şeması kullanılır. Sağlayıcı şeması ve Zod şeması aynı modülde yan yana tanımlanır ve sözleşme testleriyle alan adları/required listeleri karşılaştırılır.

Akış:

1. Gemini JSON schema ile sınırlandırılır.
2. Yanıt `JSON.parse` edilir.
3. Zod `safeParse` uygulanır.
4. Şema hatası `AI_INVALID_STRUCTURED_OUTPUT` olarak kaydedilir ve yeniden denenebilir sayılır.
5. Deneme limiti dolunca belge `FAILED_FINAL`, run ise terminal hata durumuna geçer.

Model veya ağ hatasının kök nedeni `cause` içinde kaybolmamalı; güvenli hata kodu, model adı ve request correlation bilgisi log/step kaydına yazılmalıdır. API'ye gizli sağlayıcı yanıtı veya anahtar sızdırılmaz.

## 7. API DTO sınırı

Yeni query servisleri Prisma sorgusu ve dış API arasında yer alır:

- `RunQueryService.listRuns()`
- `RunQueryService.getRunDetail(runId)`
- `PipelineQueryService.getRunPipeline(runId)`

DTO kuralları:

- `BigInt` byte alanları güvenli ondalık string olarak döner (`sizeBytes: "243316"`).
- `Date` değerleri ISO string olur.
- `triggerSource`, `slotTime`, `mode`, `targetDate` doğrudan alanlardır; frontend JSON `parameters` ayrıştırmak zorunda kalmaz.
- Liste ve detay durum enumları aynı sözleşmeyi kullanır.
- Bulunmayan run 404, beklenmeyen sunucu hatası request ID içeren 500 döndürür.
- Pipeline henüz oluşmadıysa aktif run için 200 ve boş özet/doküman listesi döner; bu durum “kayıt bulunamadı” değildir.

Silme rotası admin ve CSRF koruması altında kalır. Aktif run silme davranışı açıkça engellenir veya önce iptal use case'ine yönlendirilir; bu tasarım kapsamında aktif run doğrudan silinemez.

## 8. Frontend davranışı

- Ortak Axios istemcisi runs, stats, cron ve pipeline çağrılarında kullanılır.
- Dashboard kaynak etiketi doğrudan `triggerSource` alanından türetilir.
- `PENDING`, `RUNNING`, `COMPLETED`, `COMPLETED_WITH_ERRORS`, `FAILED` ayrı görünümler alır.
- Detay sayfası `loading`, `notFound`, `serverError`, `loaded` durumlarını ayrı tutar.
- Polling aynı run isteği bitmeden yenisini başlatmaz; terminal durumda durur ve unmount'ta iptal edilir.
- Pipeline henüz başlamadıysa “Kuyrukta / belge keşfi bekleniyor” gösterilir.
- Pipeline adımları `WorkflowStepExecution` DTO'sundan gelir; hata kodu ve kullanıcıya güvenli özet görünür.
- KPI ana değerleri ve otomatik/manüel kırılımları `/api/stats` yanıtından gelir; sabit sayılar, başarı yüzdeleri ve dağılım metinleri kaldırılır.

## 9. Modül sınırları

```text
Delivery: Fastify routes / scheduler / React query hooks
                         |
Application: StartWorkflowRun, StartRunExecution,
             RecalculateRunStatus, RunQueryService, PipelineQueryService
                         |
Domain: run/step state policies, idempotency, AI contracts
                         ^
Ports: repositories, queue, source, storage, structured AI
                         ^
Infrastructure: Prisma, pg-boss, Resmî Gazete HTTP, Gemini, local/S3
```

Route dosyaları Prisma singleton'ını doğrudan import etmez. Bootstrap bağımlılıkları oluşturup route/worker'a enjekte eder. Frontend yalnız API DTO tiplerini kullanır; Prisma veri şekline bağımlı olmaz.

## 10. Test ve kabul ölçütleri

### Backend

- Aynı issue iki farklı run'da başlatıldığında iki bağımsız run-document execution ve step anahtarı oluşur; ilk run'ın ilişkileri değişmez.
- Aynı run job'ı tekrar teslim edildiğinde çıktı çoğalmaz.
- `FAILED_FINAL` adım `ALREADY_COMPLETED` olarak dönmez.
- Son belge kalıcı hata aldığında run terminal olur.
- Gemini classification ve report çağrıları gerçek provider response schema içerir.
- Dizi, eksik alan, yanlış güven tipi ve bozuk evidence yeniden denenebilir `AI_INVALID_STRUCTURED_OUTPUT` üretir.
- Run/detail ve pipeline DTO'ları `BigInt` içerse dahi JSON serializable'dır.
- Manuel ve scheduled tetikleme aynı outbox/worker use case'ine ulaşır.

### Frontend

- `triggerSource=MANUAL` her `triggeredBy` metninden bağımsız manuel gösterilir.
- 404 “Kayıt bulunamadı”, 500 “Detaylar yüklenemedi”, `FAILED` hata, `RUNNING` aktif durum gösterir.
- Boş aktif pipeline kuyrukta görünür; kayıt yok sayılmaz.
- Polling terminal durumda durur ve üst üste istek üretmez.
- KPI kırılımları API verisiyle eşleşir.

### Canlı kabul

1. Docker API, worker, PostgreSQL, Gotenberg ve web servisleri sağlıklı olmalıdır.
2. Geçerli bir geçmiş tarih için manuel FULL run başlatılmalıdır.
3. Detay sayfası run oluşturulur oluşturulmaz açılmalı ve 500 vermemelidir.
4. Resmî Gazete issue, temel belgeler ve artefaktlar görünmelidir.
5. Gemini sınıflandırması şemaya uygun sonuç üretmeli; ilgili belgeler rapor ve taslağa ilerlemelidir.
6. Aynı tarih yeniden manuel çalıştırıldığında yeni run bağımsız tamamlanmalı, önceki run'ın detayları değişmemelidir.
7. Manuel run dashboard'da manuel görünmeli ve cron slot ilerlemesini tamamlanmış saymamalıdır.
8. Zamanlanmış/telafi run kendi slotunda görünmeli ve aynı application/worker hattıyla terminal duruma ulaşmalıdır.

## 11. Kapsam dışı

- Kurumsal OIDC sağlayıcısının kurulması.
- Otomatik e-posta gönderimi; taslak sonrası açık yönetici onayı korunur.
- Mevcut kanonik belge byte'larının zorunlu olarak çoğaltılması.
- Eski kayıtların veya artefaktların silinmesi.
