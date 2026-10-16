# Beş kaynak için ortak operasyon mimarisi ve uygulama planı

14 Ekim 2026. Tasarım önerisi; uygulama kodu, çalışan görevler ve veritabanı değiştirilmedi. Bu belge beş kaynağın ortak mimarisini tanımlar. İlk uygulama ve doğrulama dilimi Resmî Gazete olacaktır. Önceki [Resmî Gazete planı](2026-10-14-resmi-gazete-akis-plani.md) belge işleme ve örnek olay ayrıntıları için geçerlidir; ortak modül sınırları ve worker yerleşimi için bu belge esas alınacaktır.

## 1 Ana karar

**Modüler tek uygulama, bağımsız çalıştırılabilen worker grupları ve tek operasyon sözleşmesi.** Beş ayrı ürün veya mikroservis kurulmayacak. Kaynak adaptörleri farklı olabilir; belge hazırlığı, araştırma, analiz, denetim ve rapor servisleri ortaktır. Sohbet, otomasyon ve ekran aynı servisleri kullanır.

RabbitMQ çalışma mesajlarını taşır. PostgreSQL işin gerçek durumunu, ilişkilerini ve sürümlerini tutar. Nesne deposu orijinal belgeleri, sağlayıcı yanıtlarını ve büyük çıktıları saklar. Gemini içerik değerlendirir; görev durumunun, yetkinin, tarihin veya yayın kararının tek otoritesi değildir.

Kullanıcı bir sonuca yönelik istek verir. Planlayıcı gerekli aşamaları belirler; hazır ve aynı girdilere dayanan sonuçları yeniden kullanır. Kullanıcının istemediği filtre veya dış araştırma aşaması eklenmez; eksik sayfa/OCR gibi gerekli okuma önkoşulları tamamlanır.

## 2 Mevcut sistemden korunacak ve birleştirilecek parçalar

Kod incelemesinde doğrulanan mevcut parçalar:

- `OperationRequest`, `OperationTask`, `OperationAttempt`, `OperationArtifact`, `OperationOutbox` görev altyapısı mevcut. Yeni sistem bunun üzerinde gelişecek.
- `rabbitmq.ts` kalıcı mesaj, yayın teyidi, prefetch, iş kilidi ve heartbeat kullanıyor. Bu mekanizmalar sıfırdan yazılmayacak; iş durumu ve teslim durumu ayrımı sadeleştirilecek.
- `worker.ts` kaynak işleri, operasyon işleri, tarama, analiz ve zamanlayıcı köprülerini tek başlangıç dosyasında bağlıyor. Ayrı process rolleri için bölünecek.
- `execute-scan-run.ts`, `process-source-documents.ts`, `operations/executors.ts` ve sohbet rapor oluşturucusu farklı akış yolları barındırıyor. İş kuralları ortak servislere taşınacak.
- pg-boss mevcut zamanlama ve eski işleri boşaltma rolünde. İlk geçişte yalnız zamanlayıcı olarak korunacak; yeni iş yürütümü RabbitMQ üzerinden olacak. Aynı görevin iki bağımsız zamanlayıcısı olmayacak.
- Kaynak profilinde HTTP, BROWSER, TARIFF_API ve GAZETTE erişim türleri tanımlı. Bunlar ortak adapter sözleşmesinin uygulamaları olacak.

Çalışma ağacındaki değişikliklerin çalışan servislerle aynı sürüm olduğu bu incelemede bütünüyle doğrulanmadı. İlk uygulama öncesinde kod, migration ve çalışan servis sürümü kaydedilecek. Canlı kaynakların tamamı bu planlama turunda yeniden taranmadı.

## 3 Beş kaynağın yetenek ve rol tablosu

| Kaynak | Mevcut profil / erişim | Toplama görevi | Analizde kaynak rolü | Özel kapsam kontrolü |
|---|---|---|---|---|
| Resmî Gazete | GAZETTE; ana yolda HTTP, prototipte Playwright | Ana/mükerrer sayı, belge, tablo, görsel ve ekler; geçmiş mevzuat arama | Doğrulanmış resmî yayın | Gün/sayı kimliği, mükerrerler, madde ve ek tamlığı |
| Ticaret Bakanlığı | Çoklu HTTP feed | Genelge, duyuru, haber ve bağlı belgeler | Kurum yayını; belgenin türüne göre hüküm/duyuru ayrımı | Feed ve sayfa kapsamı; haberin düzenleme gibi sunulmaması |
| İGMD | HTTP | Mesleki mevzuat haberleri ve resmî kaynak bağlantıları | Mesleki destekleyici kaynak | Yorum ile resmî hükmün ayrı tutulması |
| Mevzuat.Net | Form oturumlu BROWSER | Erişilebilir mevzuat listesi, detay ve ekler | Ticari derleme; resmî bağlantı varsa ayrıca doğrulama | Mevcut son 30 kayıt görünümü geçmiş ay kapsamı garantisi vermez |
| Tariff | TARIFF_API | Duyuru akışı **ve ayrı yetenek olarak** GTİP/tarihsel önlem sorgusu | Destekleyici ticari veri | Sorgu tarihi, GTİP, menşe, koşul, birim, önlem ve abonelik durumu |

Kaynak bir alan adı olduğu için bütün içeriği aynı hukuki statüde sayılmaz. Başka kaynaktan keşfedilen RG bağlantısı doğrulanıp ayrı resmî kanıt olarak arşivlenir; keşif kaynağının izi korunur. Kullanıcı yüklemesi de yalnız başlığı nedeniyle resmî yayın sayılmaz.

Her adaptör `capabilities` bildirir: `discover`, `capture`, `searchHistory`, `lookupHistoricalData`, `supportsDateRange`, `requiresSession`. Desteklenmeyen kabiliyet boş başarılı yanıt döndürmez; `UNSUPPORTED` veya eksik kapsam sonucunu verir.

## 4 İşlevsel modüller ve sahiplik

| Modül | Sahip olduğu iş | Sahip olmadığı iş |
|---|---|---|
| workflows | İstek, plan, bağımlılıklar, durum, tekrar, iptal, tamamlanma | Belge indirmek veya prompt içinde iş sırası yönetmek |
| sources | Kaynak profili, oturum, keşif, yakalama, erişim ve kapsam | Hukuki analiz veya rapor yazmak |
| documents | Sürüm, ek ilişkisi, metin/görsel okuma, OCR, parça ve tamlık | İlgili/ilgisiz kararı veya eski hüküm bulmak |
| assessment | Kapsam kararı ve araştırma ihtiyaçları; kullanıcı seçtiğinde yalnız ihtiyaç çıkarımı | Dış servislere doğrudan gitmek |
| research | İhtiyaç bazında Tariff/RG yönlendirme, eşleştirme, önceki kanıt | Rapor tasarımı veya kaynaksız değer tamamlama |
| analysis | Güncel/önceki kanıtla değişiklik, etki, tarih ve karşılaştırma | Kuyruk ve kaynak oturumu yönetmek |
| reporting | Şablon, rapor taslağı, doğrulama, sürüm, yayın ve dışa aktarma | Yeni hukuki bilgi icat etmek |
| conversation | İstek çözümü, bağlam referansları, durum ve sonuç sunumu | Kendine ait analiz/Tariff/OCR yolu oluşturmak |
| telemetry | Olay, maliyet/kullanım, süre ve gözlemlenebilirlik | İşin başarı durumunu bağımsız belirlemek |

Yetki, erişim kapsamı ve gizli bilgiler platform hizmetleri olarak bütün girişlerde uygulanır. Genel sohbet veya açıklama sorusu workflow oluşturmak zorunda değildir; kayıtlı kanıta dayalı soru ise aynı yetkili okuma servislerini kullanır.

## 5 Önerilen dosya yapısı

Yeni isimler öneridir; mevcut klasörlerin tamamı bir defada taşınmayacak. Her modül `domain → application → ports`, dıştan bağlanan `infrastructure` ve ince `routes/adapters` düzenini izler.

```text
backend/src/
  modules/
    workflows/
      domain/
        workflow-request.ts       # Şema ve giriş/çıkış hedefleri
        task-state.ts             # Durum geçiş kuralları
        dependency-policy.ts      # Gerekli ve isteğe bağlı önkoşullar
        retry-policy.ts           # Hata sınıfına göre tekrar
        cache-key.ts              # Girdi, politika ve sürüm imzası
      application/
        plan-workflow.ts          # İş ağını kurar; sağlayıcı çağırmaz
        start-workflow.ts         # İstek, ilk işler, outbox
        execute-task.ts           # Bir görev denemesi
        advance-workflow.ts       # Sonuçtan yeni işler ve birleşme noktaları
        cancel-workflow.ts
        retry-task.ts
        query-workflow.ts
        ports.ts
      infrastructure/
        prisma-workflow-repository.ts
        rabbit-task-publisher.ts
      workflows.routes.ts
    sources/
      application/{discover,capture,search-history}.ts
      application/ports.ts
      domain/{source-capabilities,source-coverage}.ts
      infrastructure/
        adapters/{gazette,ticaret,igmd,mevzuat-net,tariff-news}.ts
        transport/{http,playwright,session-manager}.ts
    documents/
      application/{prepare-document,extract-part,verify-coverage}.ts
      domain/{evidence-part,extraction-result}.ts
      infrastructure/{pdf-reader,page-renderer,gemini-visual-reader}.ts
    assessment/
      application/{assess-document,plan-research,merge-assessment}.ts
      domain/assessment-schema.ts
      prompts/{assessment-v1,research-intent-v1}.ts
    research/
      application/{research-need,resolve-previous-rule,build-evidence-view}.ts
      domain/{research-need,snapshot-schema,comparison-policy}.ts
      infrastructure/{tariff-provider,gazette-history-provider}.ts
    analysis/
      application/{build-analysis-package,analyze-part,merge-analysis,audit-analysis}.ts
      domain/{analysis-schema,claim-evidence}.ts
      prompts/{analysis-v1,audit-v1}.ts
    reporting/
      application/{build-report,validate-report,publish-report,export-report}.ts
      domain/report-spec.ts
      infrastructure/{template-renderer,pdf-exporter}.ts
    chat/                         # Mevcut modül korunur
      application/{resolve-workflow-request,present-operation-result}.ts
  workers/
    bootstrap.ts                 # Ortak bağımlılık kurulumu
    registry.ts                  # Operation → handler → queue eşlemesi
    io-worker.ts
    browser-worker.ts
    document-worker.ts
    ai-worker.ts
    render-worker.ts
    coordinator.ts               # Outbox, lease recovery ve plan ilerletme
  platform/
    rabbitmq.ts
    database.ts
    actor-context.ts
    providers/{rate-limiter,deadline}.ts
    telemetry/{events,redaction}.ts
```

Domain katmanı Prisma, RabbitMQ veya Gemini SDK import etmez. Application yalnız portları bilir. Infrastructure domain kararlarını yeniden üretmez. Worker sadece yetki/bağlam/lease kurar ve uygulama servisini çağırır. Promptlar sürümlü dosyalarda, çıktı şemaları domain içinde olur; uzun promptlar chat handler veya executor içine gömülmez.

## 6 İstek sözleşmesi ve sohbetten giriş

Önerilen `WorkflowRequest` alanları:

```json
{
  "schemaVersion": 1,
  "intent": "ANALYZE_AND_REPORT",
  "entry": {"kind": "DOCUMENT_VERSIONS", "ids": ["version-id"]},
  "target": "REPORT_DRAFT",
  "policies": {
    "filter": "SKIP_USER_SELECTED",
    "research": "AUTO_IF_NEEDED",
    "comparison": "PUBLICATION_PREVIOUS_DAY",
    "reuse": "FILL_MISSING"
  },
  "sourceScope": ["resmi-gazete"],
  "templateRevisionId": "template-version-id",
  "instruction": "Eski ve yeni durumu karşılaştır.",
  "context": {"conversationId": "chat-id", "messageId": "message-id"},
  "idempotencyKey": "request-key"
}
```

`actorScope` ve yetki istemciden güvenilir veri olarak alınmaz; sunucu oturumundan türetilir. Tarih, kaynak ve belge kimliği açık girdiden veya kayıtlı metadata'dan çözülür. Belge yayın tarihi bilinmiyorsa bugünü yayın tarihi sayarak Tariff isteği yapılmaz; gerekli tarih için `WAITING_INPUT` oluşur. Belirsizlik yalnız ilgili işi bekletir.

| Sohbet isteği | Giriş | Hedef | Çalışmayacak gereksiz adım |
|---|---|---|---|
| Bugünün beş kaynağını tara ve raporla | Kaynaklar + tarih | Raporlar | Yok; seçili politikalara göre tam akış |
| Sadece RG'deki ilgili belgeleri listele | Kaynak + tarih | Assessment | Araştırma, ayrıntılı analiz ve rapor |
| Bu PDF'yi filtrelemeden raporla | Belge sürümü | Rapor | Kapsam filtresi |
| Bu PDF'nin yalnız metnini çıkar | Belge sürümü | Hazır kanıt | Filtre, araştırma, analiz |
| Bu GTİP'in 10 Temmuz değerini getir | Araştırma parametreleri | Tarihsel snapshot | RG keşfi, rapor |
| Bu tebliğin önceki halini bul | Belge sürümü | Önceki kanıt | Rapor |
| Bu analizden şablonla rapor oluştur | Analiz sürümü | Rapor | Tekrar kaynak toplama/analiz |
| Yalnız başlığı düzelt | Rapor sürümü | Yeni rapor revizyonu | Hukuki analizi yeniden çalıştırma |
| Yeni belgeyle analizi güncelle | Analiz + yeni kanıt | Yeni analiz/istenirse rapor | Değişmeyen kanıtı tekrar çıkarma |

`REPORT_DRAFT`, `PUBLISHED_REPORT`, `EXPORT` ve `SEND` ayrı hedeflerdir. Kullanıcının “rapor oluştur” isteği e-posta gönderimi değildir. Uygulama içi yayın varsayılanı ürün kararı olarak açıklaştırılır; mevcut sohbet yolunun otomatik yayın davranışı sessizce değiştirilmez. Yeni planner bu davranışı açık politika alanıyla temsil eder. Harici dağıtım yalnız açık talep ve ilgili yetkiyle ayrı iş olur.

## 7 Operasyon kataloğu

| Operasyon | Girdi | Çıktı | İş grubu |
|---|---|---|---|
| DISCOVER | Kaynak/tarih/profil | Belge adayları + keşif kapsamı | IO veya browser |
| CAPTURE | Kaynak URL/sürüm | Ana belge, ekler, hash ve kimlik | IO veya browser |
| PREPARE | Arşivlenmiş sürüm | Sayfa/ek envanteri ve işlenebilir parçalar | document |
| EXTRACT_PART | Metinli sayfa veya ofis bölümü | Konumlu metin/tablo | document |
| READ_VISUAL_PART | Görsel sayfa/bölge | Konumlu aktarım + belirsizlik | AI |
| VERIFY_COVERAGE | Parça envanteri ve sonuçlar | Hazır/eksik kanıt paketi | document |
| ASSESS | Hazır belge | IN/OUT/REVIEW + araştırma ihtiyaçları | AI |
| PLAN_RESEARCH | Kullanıcının seçtiği hazır belge | Filtre kararı olmadan ihtiyaçlar | AI |
| FETCH_HISTORY | GTİP/tarih veya RG arama | Ham geçmiş verisi/adayı | IO veya browser |
| RESOLVE_HISTORY | Adaylar ve hazır içerik | Önceki kanıt veya NOT_FOUND/REVIEW | AI + uygulama denetimi |
| ANALYZE_PART / MERGE_ANALYSIS | Kanıt ve araştırma sonucu | İddia/kanıt bağlı analiz | AI |
| AUDIT_ANALYSIS | Analiz + kanıt | Kontrol bulguları | Kod kontrolleri + gerektiğinde ayrı AI çağrısı |
| RENDER / VALIDATE_REPORT | Analiz sürümü + şablon | Doğrulanmış taslak | render |
| PUBLISH / EXPORT | Doğrulanmış taslak | Değişmez rapor sürümü/PDF | render |

Tablodaki operasyonlar mantıksal işlerdir; her biri ayrı mikroservis veya ayrı fiziksel kuyruk gerektirmez. Bir worker başka kuyruğun sonucunu senkron beklemez. Bir aşama fan-out oluşturur ve tamamlanır; birleşme işi gerekli sonuçlar hazır olduğunda çalışır. Dinamik ekler ve araştırma adayları aynı kuralı izler.

## 8 Beş kaynakla günlük akış

1. Zamanlayıcı seçili kaynaklar ve İstanbul tarihini içeren tek isteği kalıcı kaydeder.
2. Kaynak bazında keşif işleri açılır; her kaynağın kapsamı ayrı ölçülür.
3. Belgeler ana/ek ilişkisiyle yakalanır; doğrulanmış aynı içerik tekrar indirilmeden yeniden kullanılabilir.
4. Her belge/parça bağımsız hazırlanır; büyük belge diğer belgelerin hazır olmasını bekletmez.
5. Filtre+araştırma planı çıkarılır. IN → araştırma/analiz; OUT → gerekçeli son durum; REVIEW → inceleme/yeniden okuma.
6. Aynı mevzuat farklı kaynaklarda bulunursa kaynak gözlemleri korunur, doğrulanmış mevzuat ilişkisi kurulur. Benzer başlık tek başına birleştirme kanıtı değildir.
7. Resmî hüküm ve destekleyici açıklama ayrı kanıt rolleriyle analize girer. Farklı düzenlemeler otomatik olarak tek rapora karıştırılmaz.
8. Belge raporları bağımsız tamamlanır. Bir kaynak oturum sorunu yaşıyorsa diğer dört kaynak devam eder; günlük kapsama sonucu PARTIAL ve eksik kaynak açık olur.
9. Günlük toplu sonuç ancak bütün kaynak alt sonuçları terminal duruma geldiğinde hesaplanır. Sonradan gelen mükerrer yeni gözlem/iş oluşturur; eski raporların üstüne yazmaz.

## 9 RabbitMQ ve worker yerleşimi

Önerilen başlangıçta altı yürütme grubu ve bir koordinasyon süreci vardır. Kapasite sayıları benchmark sonucu değil başlangıç hipotezidir; yerel makine belleği, sağlayıcı kotası ve ölçülen gecikmeyle ayarlanacaktır.

| Grup / önerilen kuyruk | Görev | Başlangıç kapasite yaklaşımı |
|---|---|---|
| `workflow.io` | HTTP keşif/indirme, Tariff ve RG filtre istekleri | Toplam 4 hafif iş; domain/hesap başına ayrıca hız sınırı |
| `workflow.browser` | Playwright, form oturumu, render gereken kaynak | En fazla 2 tarayıcı işi; aynı hesap oturumu için gerekirse 1 |
| `workflow.document` | PDF render, metin çıkarma, dosya/parça doğrulama | 2 iş; büyük dosyada bellek bütçesiyle 1'e düşebilir |
| `workflow.ai.interactive` | Kullanıcının sohbetten istediği model işleri | Başlangıç 1 tüketici |
| `workflow.ai.batch` | Günlük/aylık model işleri | Başlangıç 1 tüketici |
| `workflow.render` | HTML/PDF doğrulama, sürümleme/yayın | Başlangıç 1 tüketici |
| coordinator | Outbox, zamanı gelen tekrar, lease recovery, durum toplama | Tek mantıksal sahiplik; DB kilidiyle birden fazla instance güvenli |

AI interactive/batch ayrımı iki ayrı iş mantığı değildir; aynı handler farklı hizmet sınıfında çalışır. Her iki kuyruk aynı sağlayıcı hız/token sınırına tabidir. Etkileşimli iş önceliği batch'i tamamen aç bırakmayacak rezerv/adalet kuralıyla uygulanır. Daha sonra browser/IO için de ölçüm gerektirirse hizmet sınıfı ayrılır; başlangıçta bütün kuyrukları ikiye katlamayız.

Prefetch=1 uzun/büyük işler için başlangıç tercihidir. IO kapasitesi artırılırken eşzamanlı tüketici sayısı ve prefetch ayrı kontrol edilir; `prefetch=4` tek başına kontrollü dört uygulama işi garantisi sayılmaz. Domain throttling bütün process'ler arasında ortak olmalı; sadece process içi sayaçla çoklu worker'da sınır aşılmamalıdır. İlk aşamada PostgreSQL tabanlı permit/lease; ölçüm gerektirirse daha sonra ayrı hız sınırlama altyapısı değerlendirilir.

Playwright browser process'i tekrar kullanılabilir; hesap/workspace bağlamları izole tutulur ve süreli kapatılır. Oturum çerezleri başka kullanıcının işine aktarılmaz. Gizli bilgiler queue mesajında bulunmaz. CAPTCHA/abonelik sorunu otomatik aşılmaya çalışılmaz; `WAITING_INPUT` ve ilgili bağlantı durumu gösterilir.

## 10 Mesajın uçtan uca yaşamı

1. API isteği doğrular, yetkiyi kontrol eder. Aynı idempotencyKey ve aynı payload önceki isteği döndürür; aynı anahtarla farklı payload 409 üretir.
2. İstek, ilk task kayıtları ve outbox tek PostgreSQL transaction'ında yazılır. HTTP 202 işin kabul edildiğini belirtir, başarıyı değil.
3. Dispatcher çalışabilir task için küçük mesaj yayımlar: `schemaVersion`, `messageId`, `taskId`, `dispatchGeneration`, `correlationId`. Kanıt JSON/PDF'si mesajda taşınmaz.
4. Publisher confirm alındıktan sonra outbox DISPATCHED olur. Confirm kaybolursa tekrar yayın olabilir; bunun için idempotent task gerekir.
5. Consumer task'ı DB'den yükler, yetki/iptal/bağımlılık kontrolünü yapar ve attempt numarasıyla lease alır.
6. Handler bir sınırlandırılmış iş birimini çalıştırır; heartbeat ve sağlayıcı deadline ayrı tutulur.
7. Nesne deposuna içerik hash'iyle çıktı yazılır; çıktı referansı, task sonucu, olay ve sonraki işler/outbox aynı DB transaction'ıyla kaydedilir. DB yazımı başarısızsa sahipsiz nesne daha sonra temizlenebilir; rapor görünür olmaz.
8. Başarılı kalıcı kayıttan sonra consumer ACK verir. Önce sonuç yazılıp ACK kaybolursa yeniden teslim görev sonucunu görüp aynı işi yeniden yayımlamaz.
9. Hata halinde tekrar kararı ve zamanı DB'ye yazılır. Yeni outbox kalıcılaştıktan sonra mevcut mesaj ACK edilir. DB erişimi yoksa ACK verilmez; teslim yeniden ele alınır.

Bu **en az bir kez teslim + tekil sonuç üretimi** tasarımıdır; ağ üzerinde “tam olarak bir kez çağrı” garantisi değildir. Sağlayıcı cevabı alındıktan sonra kalıcı kayıt öncesi çöküşte yeniden çağrı ve ek maliyet mümkün olabilir. Attempt/kullanım kaydı bunu görünür kılar; dış servis destekliyorsa idempotency anahtarı kullanılır.

Operasyon seviyesinde tek lease sahibi olacak. Mevcut BackgroundJob teslim kaydıyla OperationTask lease'inin aynı işi iki farklı kural setiyle yeniden denemesi engellenecek. Geçişte legacy kuyruklar mevcut mantıkla çalışabilir; yeni workflow kuyruğunda task/attempt otoritedir.

Dayanak: [RabbitMQ acknowledgements ve confirms](https://www.rabbitmq.com/docs/confirms), [prefetch](https://www.rabbitmq.com/docs/consumer-prefetch). Broker onayı, iş mantığının tamamlandığını göstermez.

## 11 Durumlar, tekrar ve bağımlılıklar

Task durumları: PENDING_DEPENDENCIES → READY → RUNNING → SUCCEEDED; alternatifler RETRY_SCHEDULED, WAITING_INPUT, REVIEW_REQUIRED, FAILED, CANCELLED ve SKIPPED. Sonuç içeriği ayrıca FOUND, NOT_FOUND, IN, OUT veya karşılaştırma eksik gibi alanlar taşır. Araştırmanın başarıyla tamamlanıp NOT_FOUND dönmesi, teknik FAILED değildir.

Workflow durumu türetilir: QUEUED, RUNNING, WAITING_INPUT, SUCCEEDED, PARTIAL, FAILED, CANCELLED. `executionStatus`, `coverageStatus`, `researchStatus`, `reportStatus` ayrı alanlardır; tek yeşil rozet bütün doğruluğu temsil etmez.

| Hata | Politika |
|---|---|
| 429, geçici 5xx, ağ kopması | Retry-After varsa uygula; yoksa jitter ile artan bekleme; toplam deneme ve süre bütçesi |
| Süresi dolmuş oturum | Bir kontrollü yenileme; devam ederse kullanıcı/bağlantı işlemi |
| Kalıcı yetki/abonelik sorunu | WAITING_INPUT; otomatik sonsuz tekrar yok |
| Eksik sayfa, bozuk dosya | İlgili parçayı yeniden yakala/oku; çözülmezse REVIEW_REQUIRED |
| Model şema hatası | Sınırlı düzeltme denemesi; aynı büyük paketi sınırsız tekrar etme |
| Bağlam sınırı | Paket/parça planını değiştir; veri keserek başarıya geçme |
| İptal | Yeni çocuk işleri açma; mümkünse çalışan sağlayıcı isteğini iptal et; yayın commit'inden önce tekrar kontrol |

Tekrar otoritesi workflow servisidir. SDK ve transport katmanının iç tekrarları ölçülür ve üst bütçeden düşer. Yeni işlerde mevcut Rabbit retry döngüsüyle ikinci bağımsız tekrar sistemi kurulmaz. Ertelenmiş işler `availableAt` ile outbox üzerinden yayımlanır; worker uyuyarak kapasite tutmaz. Bozuk veya tanınmayan mesajlar kalıcı failure kuyruğuna alınır. Failure queue tek başına kullanıcı hata ekranı değildir. [RabbitMQ dead-letter davranışı](https://www.rabbitmq.com/docs/dlx).

Bağımlılıklar REQUIRED ve OPTIONAL olarak tanımlanır. Ana belgenin okunması REQUIRED; önceki kaynağın bulunması bazı raporlarda OPTIONAL'dır. Önceki arama hatası yine görünür olur. Bir fan-out bittiğinde beklenen çocuk kimlikleriyle tamamlananlar eşitlenir; kısmi sonuç tam sonuç gibi birleştirilmez.

## 12 Kanıt, OCR, Tariff ve model girdi sözleşmesi

`EvidenceBundle` kaynak rolünü, belge sürümünü, parçalarını, tamlık durumunu ve hash'lerini taşır. `AnalysisPackage` buna araştırma sonuçlarını, zaman politikasını, kullanıcının talimatını ve çıktı sözleşmesini ekler. Model çağrısı paketin hangi parçalarını gördüğünü `ModelInputManifest` olarak kaydeder.

Tariff: yeni belge 11 Temmuz ise eski durum 10 Temmuz sorgusudur; yeni değer RG'den gelir. Yürürlük tarihi ayrı gösterilir. Tam ham yanıt saklanır. Gerekli önlemlerin görünümünde menşe, koşul, istisna, geçerlilik, birim ve yasal dayanak korunur. İhtiyaç dışı kayıtların çıkarılma gerekçesi kaydedilir. 120 KB nedeniyle sessiz atlama kaldırılır. Sığmayan gerekli veriler ayrı işlerde okunur.

OCR: sayfa bazında native/görsel/belirsiz/boş durumu tutulur. 100 sayfanın 92'si okunabiliyorsa kalan 8 sayfa sessizce düşmez. Görsel okuma ham aktarımdır; analiz değildir. Tablo devamları, dipnotlar ve kritik rakamlar doğrulanır. Belgenin sadece bir sayfasının okunabilir olması READY için yeterli değildir.

Model promptları ayrı görevler taşır: assessment, research intent, aday değerlendirme, görsel aktarım, analiz, analiz denetimi ve gerekirse rapor anlatımı. Her biri sürümlü şema döndürür. Kaynak sayısı, kimlik kümesi, alıntı eşleşmesi, tarih politikası, birim ve HTML karşılaştırma kapsamı kodla kontrol edilir. Model denetimi bu kontrollerin yerine geçmez.

Küçük kanıt paketi tek çağrıda; büyük paket madde/sayfa/tablo bazında işlenir. Son sentez bütün parça sonuçlarını içerir ve ham kanıta geri erişebilir. Bütün ham veriyi tek çağrıda gördüğü iddia edilmez. Token, dosya, sayfa ve çıktı bütçeleri ayrı ölçülür.

## 13 Veri modeli ve sürümleme

| Veri grubu | Kalıcı kayıt | İçerik |
|---|---|---|
| Talep ve işler | Mevcut OperationRequest/Task/Attempt/Outbox genişletilir | Politika snapshot, giriş/hedef, dependencies, retry, lease |
| Kaynak envanteri | Source, Profile, Observation, Coverage | Profil sürümü, sayfalar, eksikler, ilk/son gözlem |
| Belgeler | Document, DocumentVersion, StoredObject, DocumentLink | Değişmez içerik, kaynak/ek ilişkisi, yetki kapsamı |
| Okuma kapsamı | EvidencePart ve ExtractionAttempt önerisi | Sayfa/bölge, yöntem, okunabilirlik, sonuç nesnesi |
| Araştırma | ResearchNeed/Attempt ve ProviderSnapshot önerisi | GTİP, tarih, arama kapsamı, ham yanıt, sonuç |
| Analiz | AnalysisRevision, ClaimEvidence önerisi | İddia, dayanak, kaynak rolü, eksik/çelişki |
| Rapor | ReportRevision ve taslaklar | Analiz sürümü, şablon sürümü, denetim ve yayın izi |
| İzleme | WorkflowEvent, ModelInputManifest ve mevcut usage kayıtları | Kim neyi işledi, ne zaman, hangi girdilerle |

Büyük body'ler nesne deposunda, sorgulanacak ilişkiler DB'de tutulur. Şema migration'ı eklemeli başlar. Eski kayıtların kanıtı veya provenance'ı tahminle doldurulmaz; LEGACY/UNVERIFIED olarak görünür. Kaynak kapsamı, araştırma tarihi ve prompt değişikliği cache anahtarını etkiler.

Tekrar kullanım anahtarı: actorScope + operation + sıralanmış input hashes + ilgili politika/prompt/adapter/model/extractor sürümleri. Aynı resmî belge fiziksel olarak bir kez saklanabilir; özel belgelerin erişimi ve analiz çıktısı scope dışına taşınmaz. Mevzuat kimliğiyle gruplama ile dosya hash'iyle tekilleştirme farklı işlemlerdir. Güncel feed keşfi yeni öğeler için yeniden yapılır; değişmez arşiv nesnesi tekrar indirilmeyebilir.

## 14 Kullanıcıya cevap üretme

Kullanıcı cevabı iki katmandır: **iş durumu** ve **kaynaklı içerik**. İş durumu DB/event kaydından deterministik üretilir. Analiz anlatımı doğrulanmış AnalysisRevision üzerinden oluşturulur. Sohbet modeli kendi başına “tamamlandı” sonucu veremez.

API kabul yanıtı: requestId, executionStatus, planSummary, eventsUrl, resultLinks. Detay yanıtı: counts, coverage, tasks, research outcomes, warnings, nextActions ve artifact links. Arayüz ham nesne deposu anahtarlarını veya kimlik bilgisi içeren API bağlantılarını göstermez; yetkili kanıt görüntüleyicisine bağlanır.

Örnek kullanıcı mesajları, biçim sözleşmesini anlatan taslaklardır:

- Kabul: “Belgeyi filtrelemeden işleyeceğim. Gerekli sayfaları okuyup önceki bilgiyi araştıracak, ardından rapor hazırlayacağım.”
- İlerleme: “100 sayfanın 92'si hazır. Kalan 8 sayfa görsel olarak okunuyor.”
- Araştırma: “7 GTİP'in 5'i doğrulandı. İki kod için resmî kaynak araştırması sürüyor.”
- Eksik geçmiş: “Yeni düzenleme raporu hazır. Önceki değer bulunamadığı için eski–yeni kıyası eklenmedi.”
- Kısmi kaynak: “RG raporları hazır. Mevzuat.Net oturumu yenilenmeli; günlük kapsam henüz tamamlanmadı.”
- Gerekli bilgi: “Belgenin yayın tarihi doğrulanamadı. Önceki gün sorgusu için yayın tarihini belirtin.”

SSE veya event polling aynı kalıcı event kaynağını tüketir. Öneri: workflow event endpoint'i, artan sequence ve son event kimliğiyle yeniden bağlanma. Polling yedeği aynı read model'i kullanır. Sohbet streaming bağlantısının kapanması kabul edilmiş işi iptal etmez. Kullanıcı tekrar açınca mevcut request okunur; aynı iş yeniden başlatılmaz.

İlerleme mesajları anlamlı aşama değişiminde ve toplu sayaç güncellemesinde verilir; her sayfa için sohbet spam'i oluşturulmaz. İstemci `eventId` ile tekrarları eler. Tamamlanma bildirimi request+result revision ile tekilleştirilir. İleri kullanıcı için “Teknik ayrıntı” panelinde queue, task, attempt, prompt sürümü ve hata görünür.

## 15 İzleme, performans ve işletim

Her task: correlationId, requestId, parentTaskId, documentVersionId, sourceId, stage, attempt, lease generation, zamanlar, girdi/çıktı manifestleri ve sonuç taşır. İş logları kimlik bilgilerini temizler. Model girdilerinin tamamı genel log satırına dökülmez; yetkili arşiv referansı kullanılır.

Ölçümler: kuyrukta bekleme, çalışma süresi p50/p95, aktif işler, yeniden deneme oranı, sağlayıcı 429, domain erişim hatası, okunmamış sayfa, NOT_FOUND/REVIEW oranı, kapsam dışı kararları, token/maliyet ve tekrar kullanım oranı. Kapasite bu verilerle ayarlanır; başlangıç concurrency sayıları performans garantisi değildir.

Bağımsız alarmlar: outbox beklemesi, lease ilerlememesi, failure kuyruğu artışı, aynı kaynakta erişim sorunu, model kullanımının beklenmedik artışı. Worker canlılığı ile iş ilerlemesi ayrıdır. Sağlıklı heartbeat sonsuz ilerlemeyen işi gizlememeli; toplam deadline ve son ilerleme zamanı denetlenir.

Kapatma: consumer yeni iş almayı durdurur, kısa işler tamamlanır; uzun iş iptal/kayıt sınırına gelerek lease bırakır. Eski worker'ın gecikmiş sonucu attempt/fencing kontrolünden geçmeden yazılamaz. CPU ağır PDF işlemi ayrı process grubunda yürür; event loop'u kilitleyip heartbeat'leri düşürmez.

## 16 Mevcut dosyalardan hedefe geçiş haritası

| Mevcut dosya/grup | Geçiş |
|---|---|
| `scan-runs/application/execute-scan-run.ts` | RG workflow giriş adaptörü; aşama iş mantığı ortak servislere |
| `managed-sources/run-selected-sources.ts`, `source-scan-run.ts`, `process-source-documents.ts` | Kaynak başına uzun seri zincir yerine ortak planlayıcının alt işleri |
| `managed-sources/source-profile.ts`, `source-session.ts`, `source-collector.ts`, `source-attachments.ts` | Sources adaptörleri ve ortak transport/capture |
| `scan-runs/infrastructure/resmi-gazete-search.ts`, `official-http-client.ts` | Gazette adapter ve history provider |
| `gazette-prototype/*` | Doğrulanmış collector/research parçaları portlara taşınır; bağımsız üretim motoru olmaz |
| `documents/application/extract-document.ts` | Hazırlık, parça çıkarımı ve görsel okuma servislerine ayrılır |
| `scan-runs/application/execute-document-filter.ts`, prompt/schema dosyaları | Assessment modülüne |
| `execute-previous-source-discovery.ts`, `operations/previous-source-executor.ts` | Aynı research servisinin adaptörlerine |
| `tariff/tariff-lookup.ts`, `operations/report-tariff-evidence.ts`, `topic-analysis/application/enrich-with-tariff.ts` | Tek tarihsel sağlayıcı ve evidence view; yinelenen tarih/sınır kuralları kalkar |
| `topic-analysis/application/execute-topic-analysis.ts`, `operations/executors.ts` analiz bölümü | Ortak analysis servislerine |
| `operations/operation-service.ts` | Workflow planner/executor/repository sorumluluklarına aşamalı ayrılır |
| `operations/operation-dispatcher.ts`, `platform/rabbitmq.ts` | Ortak outbox ve teslim adaptörü |
| `worker.ts` | Worker bootstrap + registry + process rolleri |
| `chat/application/send-chat-message.ts`, `chat-operations.ts`, `create-chat-report.ts` | İstek çözümü ve ortak workflow çağrısı |
| `chat/infrastructure/prisma-chat-report-creator.ts` | Kendi görev zinciri yerine start-workflow çağrısı |
| `operations/report-analysis-service.ts` | Ortak analiz revizyon isteği |
| `topic-analysis/application/{build-report-spec,produce-report-document,render-report-html,validate-report-html}.ts` | Reporting modülünün mevcut uygulamaları olarak yeniden kullanım |
| `workspace/automations.ts` | Schedule → idempotent workflow isteği; analiz içermeyen zamanlayıcı |
| `backend/prisma/schema.prisma` | Eklemeli şema, ilişkiler, kapsam ve olay kayıtları |
| `frontend/src/features/operations/*`, `runs/RunFlow.tsx`, `workspace/BackgroundMonitor.tsx`, chat bileşenleri | Aynı workflow read model ve olayları kullanan görünümler |

Yol tablosundaki backend yolları `backend/src/modules/` altındadır; `platform`, `worker.ts` ve açık yazılmış yollar istisnadır. Klasör taşıma tek başına hedef değildir; her adımda davranış ortaklığı kanıtlanmalıdır.

## 17 Aşamalı uygulama ve teslimler

| Aşama | Teslim | Kabul |
|---|---|---|
| A Tasarım sabitleme | Operasyon kataloğu, giriş/hedef politikaları, durumlar ve örnek API'ler | Aynı kullanıcı isteği için tek, açıklanabilir plan |
| B Kaynak/örnek envanteri | RG 30 gün; diğer dört kaynağın kabiliyet ve erişim sözleşmeleri | Kapsam sınırlamaları ve zor belge türleri açık |
| C Ortak workflow iskeleti | Mevcut Operation tablolarına dayanan planner, registry ve outbox | Tek belge işi tekrar teslimde çift çıktı üretmez |
| D Belge hazırlığı | Sayfa/ek kapsamı, OCR, büyük belge parçalama | Karma PDF'nin hiçbir gerekli sayfası kaybolmaz |
| E RG uçtan uca | Filtre+plan, 10 Temmuz Tariff snapshot, önceki RG, analiz/rapor | Örnek yedi GTİP ve büyük belgeler kapsanır |
| F Sohbet eşitliği | Aynı belgenin sohbet ve otomasyon yolları | Aynı politika/girdi için eşdeğer kanıt ve görev planı |
| G Dört adaptörün bağlanması | Ticaret, İGMD, Mevzuat.Net ve Tariff feed | Kaynak rolleri, oturum/kapsam ve bağımsız hata durumları |
| H İşletim ve arayüz | Worker rolleri, adalet, olaylar, iptal/tekrar, maliyet | Büyük batch sırasında tek belge sohbeti çalışabilir |
| I Gölge çalışma ve geçiş | Bir aylık kıyas, ölçümler, sürümlü etkinleştirme/geri dönüş | Kritik yanlış dışlama, sessiz kayıp ve çift yayın yok |

Her aşama sonunda değişen dosyalar, örnek girdi/çıktı, test sonucu, açık sorunlar ve sonraki adım kullanıcıya kısa özet + teknik ek olarak sunulur. Bir önceki kabul sonucu görülmeden yeni büyük kapsam açılmaz. Beş kaynak aynı anda yeniden yazılmaz; RG dilimi çalışırken ortak sözleşme sabitlenir.

## 18 Test ve geçiş kuralları

- Birim: tarih, kapsam, birim/menşe, policy, state transition, idempotency ve cache invalidation.
- Adaptör: her kaynak için kaydedilmiş gerçek yanıt örnekleri; sayfalama, oturum, eksik ek ve tarih davranışı.
- Entegrasyon: PostgreSQL + RabbitMQ + nesne deposu; confirm kaybı, redelivery, lease kaybı, outbox recovery, fan-out/join, optional dependency ve iptal.
- Model sözleşmesi: şema uygunluğu yanında sayfa/madde/GTİP kümesi ve kanıt eşitliği; aynı modelin kendi kararını tek doğruluk ölçütü saymama.
- Uçtan uca: sohbetten filtre atlama, yalnız OCR, yalnız araştırma, kayıtlı analizden rapor, beş kaynakta birinin erişim hatası, uzun PDF ve sonradan mükerrer.
- Yetki: özel belge cache'i, source session, artifact görüntüleme, görev yeniden denemesi ve worker başlangıcında erişim kontrolü.
- Performans: bekleme/süre/kullanım temel ölçümü; concurrency ve prefetch'i gerçek makine ve kota sınırlarına göre ayarlama.

Migration eklemeli olur. Eski raporlar değişmez. Yeni request oluşturulurken engineVersion sabitlenir; devam eden işte motor değiştirilmez. Geçiş bayrağı source/request scope düzeyinde uygulanır. Legacy kuyruklar boşaltılmadan silinmez. Geri dönüş yalnız yeni isteklerin eski motora yönlenmesini sağlar; yeni kanıtlar veya rapor sürümleri silinmez. Hedef tablolar oturduktan sonra eski çift yollar kaldırılır.

## 19 Açık ürün kararları ve önerilen varsayılanlar

Bu kararlar planlama incelemesinde netleştirilecek; mevcut sistemde uygulanmış değildir:

1. “Rapor oluştur” çıktısı: öneri doğrulanmış uygulama içi taslak; uygulama içi otomatik yayın ayrıca açık politika. Harici gönderim daima ayrı talep.
2. RG dışı kaynakta önceki araştırma: öneri yalnız tespit edilen değişiklik ihtiyacına göre; bütün haberlerde Tariff/RG çağrısı yapılmaması.
3. Çok kaynaklı aynı mevzuat: öneri doğrulanmış kimlikle ortak kanıt paketi; kaynaklara özgü ek yorum korunarak tek mevzuat raporu. Belirsiz eşleşmede ayrı kayıt.
4. Önceki kaynak yokluğu: kullanıcı yönlendirmesine uygun olarak mevcut belge raporu devam eder, karşılaştırma yokluğu görünür.
5. Kaynak erişilemezliği: diğer belgeler devam eder, günlük kapsam PARTIAL olur; “o gün değişiklik yok” denmez.
6. Chat önceliği: öneri ayrılmış AI tüketici kapasitesi + batch için korunmuş kapasite; ölçümle oran ayarı.

Sonraki somut tasarım teslimi, bu mimarinin üç uçtan uca plan çıktısıdır: beş kaynak günlük tarama; sohbetten filtre atlanan PDF; tamamlanmış analizden yalnız rapor. Her biri görev bağımlılıkları, örnek kayıtlar, mesajlar ve kullanıcı cevaplarıyla doğrulanacaktır.
