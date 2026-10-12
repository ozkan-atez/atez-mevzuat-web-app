# ATEZ modüler işlemler ve belge ekleme uygulama planı

11 Ekim 2026

Chat, manuel ekranlar ve otomasyonlar aynı bağımsız işlemleri kullanacak. Kullanıcı kayıtlı bir belgeyi sorgulayabilecek, eksik bir günün verisini alabilecek, yalnızca analiz çalıştırabilecek ve seçilen ATEZ şablonuyla rapor taslağı oluşturabilecek. Belge yükleme, bağlantı ekleme ve arşivden seçme bu akışın giriş yollarıdır.

Bu plan uygulama sırasını ve kabul ölçütlerini tanımlar. Özelliklerin tamamlandığını ifade etmez. Mevcut Fastify, Prisma, PostgreSQL, MinIO, React, Ant Design ve RabbitMQ yapısı korunur. Yeni bir uygulama veya ikinci bir otomasyon motoru kurulmaz.

## Uygulama durumu 11 Ekim 2026

Yerel uygulamada belge ekleme ve ortak arşiv, bağımsız işlem yürütücüsü, sohbet ekleri, otomasyonun tek adım ekranı ve çalışma dışı rapor taslağı etkinleştirildi. Analiz, önceki kaynak ve Tariff çıktıları bir belge paketinde birleştirilebiliyor. Ana belge ve destekleyici kaynak rolleri ile kanıta bağlı çelişkiler kaydediliyor. Kaynak profili, otomasyon ayarı ve şablon işlem başında sabitleniyor.

Üç ek migration ve arşiv eşlemesi uygulandı. Eski kayıtlar korundu. Sağlayıcı bağlantısı sorunlu olduğu için canlı Gemini doğrulaması yapılmadı; otomatik testler sahte AI ve izole veritabanı kullanıyor. İşletim ve geri dönüş adımları [modüler işlem kılavuzunda](../../operations/modular-operations.md) yer alır.

Son doğrulama: backend 72 dosyada 388 test, frontend 35 dosyada 126 test başarılı. Her iki derleme geçti. Yerel sağlık kontrolünde veritabanı, nesne deposu ve kuyruk hazır; işlem kuyruğunda worker tüketicisi mevcut. Arşiv ve sohbet belge seçicisi tarayıcıda doğrulandı. 507 eski kayıt eşlemesi yinelenen girdiler birleştirilerek 181 belge ve 184 sürüm oluşturdu.

| Kısım | Durum |
| --- | --- |
| Belge ekleme, metin çıkarma ve arşiv seçimi | Uygulandı; OCR gerektiren içerik açık durumla bekliyor. |
| Kalıcı işlemler, önbellek, outbox, iptal ve tekrar deneme | Uygulandı; ayrı görev lease ve deneme kayıtları kullanılıyor. |
| Keşif, indirme, filtre, önceki kaynak ve Tariff | Bağımsız yürütücüler ve ekranlar uygulandı; canlı sağlayıcı doğrulaması bekliyor. |
| Çok belgeli analiz, roller, kanıt ve çelişkiler | Uygulandı; bağımsız analizler sürümlü OperationArtifact içinde. Eski AnalysisRevision/EvidenceBundle çekirdeğine tam taşıma tamamlanmadı. |
| ATEZ taslağı, içerik düzenleme, yayımlama ve sürümler | Mevcut ReportDraft/ReportFieldEdit/TopicReport/ReportRevision modellerine bağlandı. |
| Sohbet araçları ve AI olmadan kayıt sorguları | Uygulandı; eklerin sürümü mesajda korunuyor. |
| Otomasyon tek adım çalıştırma | Uygulandı; tüm cron akışının yeni görev modeline taşınması tamamlanmadı. |
| Erişim kontrolü | Ortak yerel çalışma alanı sınırı uygulandı. Paylaşılan kullanıcı kimliği ve kapsam yetkilendirmesi tamamlanmadı. |

## Kullanıcı deneyimi ve kapsam

İlk teslim aşağıdaki senaryoları uçtan uca karşılamalıdır:

1. Kullanıcı belirli bir gün ve kaynak için kayıtlı belgeleri, raporları, otomasyon çalışmalarını ve hataları sorgular.
2. O günün kapsamı eksikse yalnızca eksik keşif ve belge alma işlemlerini başlatır.
3. Arşivlenmiş belgeleri yeniden indirmeden seçili sürümler üzerinden analiz üretir.
4. PDF, DOCX, XLSX, CSV, TXT veya desteklenen bir görsel yükler; belgeyi kaydeder, ardından isterse analiz ettirir.
5. HTTPS bağlantısından belge ekler veya mevcut arşivden belge seçer.
6. Birden fazla belgeyi tek analizde ilişkilendirir; bir belgeyi ana belge, diğerlerini ek kanıt olarak seçebilir.
7. GTİP kodunu tarih ve menşe ile Tariff üzerinden sorgular; sonucu isterse analiz kanıtına ekler.
8. Kayıtlı analizden seçilen ATEZ şablonuna uygun bir rapor taslağı oluşturur.
9. Rapor taslağının içeriğini düzenler, değişiklikleri gözden geçirir ve yeni sürüm olarak yayımlar.
10. Aynı işlemleri günlük otomasyon içinde veya bir ekrandaki işlem düğmesiyle çalıştırır.

Belge yüklemek analiz çağrısını otomatik başlatmaz. Analiz üretmek rapor yayımlamaz. Rapor yayımlamak e-posta göndermez. Kullanıcı isterse birkaç adımdan oluşan bir iş isteyebilir; hangi adımların çalışacağı başlangıçta görünür olmalıdır.

## Mevcut kod ve kullanılacak parçalar

| Alan | Mevcut parça | Yapılacak değişiklik |
| --- | --- | --- |
| Chat veri erişimi | `chat/application/chat-tools.ts`, `prisma-assistant-knowledge.ts` | Otomasyon, çalışma ayrıntısı, bütün belge kökenleri, görevler ve belge sürümleri eklenir. |
| Chat yürütme | `send-chat-message.ts`, `scan-intent.ts`, `report-query.ts` | Okuma ve işlem talepleri ayrılır; ortak tarih çözümleme ve görev servisi kullanılır. |
| Kaynak tarama | `source-scan-run.ts`, `source-collector.ts`, `source-attachments.ts` | Keşif, indirme, doğrulama ve işleme bağımsız yürütücülere ayrılır. |
| Belge filtresi | `execute-document-filter.ts` | Çalışma yerine seçilmiş belge sürümleri üzerinden de çalışabilir. |
| Önceki kaynak araştırması | `execute-previous-source-discovery.ts` | Tek belge veya seçilmiş belge grubu için çağrılabilir. |
| Analiz ve kanıt | `execute-topic-analysis.ts`, `build-evidence-bundle.ts` | Kanıt girdisi çalışmadan bağımsız hale gelir; mevcut topic akışı adaptör olarak korunur. |
| Tariff | `tariff-lookup.ts`, `enrich-with-tariff.ts` | Sorgu sonucunun sürümlü kanıt kaydı ve bağımsız görev bağlantısı eklenir. |
| Rapor | `build-report-spec.ts`, `render-report-html.ts`, `publish-report-draft.ts` | Analizden taslak üretme, yayımlamadan bağımsız hale gelir. |
| Şablonlar | `report-template-catalog.ts`, `apply-automation-template.ts` | Sabit kurumsal alanlar korunur; seçilen şablonun anlık kopyası görevde saklanır. |
| Kuyruk | `platform/rabbitmq.ts`, `worker.ts`, mevcut outbox tabloları | Ortak görev kuyruğu, outbox ve görev sonucu bağlantıları eklenir. |
| Belge kaydı | Prisma `Document`, `DocumentVersion`, `StoredObject` | Bu modeller genişletilir; yeni bir paralel belge arşivi oluşturulmaz. |
| Revizyon | `TopicProcess`, `AnalysisRevision`, `ReportDraft`, `ReportRevision` | Çalışma dışında başlatılan analiz ve raporlar için ilişkiler genişletilir. |

Bugünkü `BackgroundJob` kuyruk kilidi ve deneme kaydıdır; kullanıcıya gösterilecek iş tanımı yerine kullanılmamalıdır. Yeni görev kaydı işin girdisini, kapsamını ve çıktısını tutar; mevcut kilit sistemi teslim ve yürütme güvenilirliğini sağlar.

Dış kaynaklardaki mevcut `analyze` çağrısı kaynak çalışmasını yeniden kuyruğa alabilir. Geçişte bu davranış özellikle değiştirilecektir: yalnızca analiz talebi keşif veya indirme başlatmayacaktır.

## Bağımsız görev sözleşmesi

Her görev tek bir işlem türünü temsil eder. Bir kullanıcı isteği veya otomasyon çalışması birden fazla görev içerebilir.

| İşlem | Girdi | Çıktı | Tek başına çalıştırma koşulu |
| --- | --- | --- | --- |
| `DISCOVER` | Kaynak, tarih aralığı, tarih politikası, profil sürümü | Belge adayları ve kapsam kaydı | Kaynağın etkin ve erişilebilir profili bulunur. |
| `CAPTURE` | Seçili aday veya URL, bilinen sürüm, ek dosya kapsamı | Arşivlenmiş belge sürümü ve ekleri | Keşif gerekmiyorsa doğrudan aday veya URL kullanılabilir. |
| `EXTRACT` | Belge sürümü ve çıkarıcı sürümü | Metin, tablolar, sayfa referansları ve çıkarma durumu | Dosya doğrulanmış ve arşivlenmiş olmalıdır. |
| `FILTER` | Belge sürümleri ve filtre politikası | Gerekçeli ilgili veya ilgisiz kararları | Gerekli okunabilir içerik veya desteklenen model girdisi vardır. |
| `PREVIOUS_SOURCES` | Belge sürümleri ve atıflar | Önceki belge sürümleri ve ilişki kayıtları | Atıf bulunmaması başarılı boş sonuç olabilir. |
| `TARIFF_LOOKUP` | GTİP, tarih, isteğe bağlı önceki tarih ve menşe | Kaynaklı Tariff sorgu çıktısı | Hesap ve gerekli erişim kullanılabilir olmalıdır. |
| `ANALYZE` | Seçili belge sürümleri, kanıt paketi, talimat, model sürümü | Sürümlü analiz ve kanıt referansları | Filtre zorunlu ön koşul değildir; kullanıcı seçili belgeyi doğrudan analiz ettirebilir. |
| `BUILD_REPORT` | Analiz sürümü, şablon anlık kopyası | Doğrulanmış rapor taslağı | Analiz sonucu rapor üretimine uygun olmalıdır. |
| `REVISE_ANALYSIS` | Analiz sürümü, talimat, ek kanıtlar | Yeni analiz sürümü | Yeni sürüm eski kanıtları ve ek kanıtları açıkça belirtir. |
| `REVISE_REPORT` | Taslak veya rapor sürümü, içerik değişiklikleri | Kaydedilmiş taslak değişiklikleri | Yayımlanmış rapor doğrudan değiştirilmez. |

`PUBLISH_REPORT` ve dağıtım da bağımsız uygulama işlemleridir. Yayımlama mevcut sürüm kontrolünü kullanır. E-posta gönderimi açık bir kullanıcı işlemi veya açıkça yapılandırılmış dağıtım kuralı gerektirir; yeni chat iş akışının varsayılan adımı değildir.

Keşif sırasında gerekli oturum açma yardımcı işlemdir; kendi başına kullanıcıya bir belge çıktısı üretmez. Aynı şekilde doğrulama, dosya kaydının zorunlu koşuludur. Bu teknik yardımcılar görev günlüklerinde görünür; kullanıcıdan ayrı komut istemez.

## Çalıştırma seçenekleri ve bağımlılıklar

Üç seçenek hem API hem chat hem ekranlarda aynı anlama gelir:

- `REUSE_ONLY`: Yalnızca kayıtlı ve uygun sürümler kullanılır. Eksik veri varsa eksikler döner; scraping veya AI çağrısı başlatılmaz.
- `FILL_MISSING`: İstenen kapsam için yalnızca eksik veya geçersiz çıktılar üretilir. Mevcut uygun sonuçlar yeniden kullanılır.
- `FORCE`: Seçilen işlem yeni bir sonuç sürümü üretir. Önceki sonuçlar silinmez. Önceki ve sonraki bütün adımlar kendiliğinden yeniden çalıştırılmaz.

Sorgu talepleri varsayılan olarak `REUSE_ONLY` davranır. “Eksikleri getir” gibi işlem talepleri `FILL_MISSING` davranır. “Yeniden analiz et” yalnızca `ANALYZE` için `FORCE` anlamına gelir. Belirsiz bir işlemde asistan kaynak, tarih, belge veya istenen adımı sorar.

Planlayıcı ön koşulları kontrol eder. `REUSE_ONLY` altında eksik bir metin varsa analiz yerine eksik çıkarma sonucu bildirilir. `FILL_MISSING` altında gerekli çıkarma görevi önce oluşturulabilir; bunun görev listesinde görünmesi gerekir. Bir ön koşul hatası diğer bağımsız belgelerin başarılı sonuçlarını kaybettirmez.

Bir rapor başlığı veya kullanıcı talimatı değişikliği veri indirme önbelleğini bozmaz. Belge sürümü değişirse o sürümü kullanan analiz için yeni girdi imzası oluşur. Model, prompt, çıkarıcı veya şablon sürümü değişikliği yalnızca etkilediği sonuç türünün yeniden kullanım kararını değiştirir.

## Veri modeli ve sürüm ilişkileri

### Belgeler

`Document` mantıksal belge kimliğidir. `DocumentVersion` belirli bir içerik sürümüdür. Bir dosyanın depolanmış baytları `StoredObject` üzerinden bulunur. Aynı dosyanın chat, kaynak veya rapora bağlanması yeni fiziksel dosya üretmez.

Önerilen şema değişiklikleri:

- `Document`: `origin` değeri `SOURCE`, `UPLOAD` veya `USER_TEXT`; `sourceId`, `canonicalUrl` ve `publishedOn` kaynak bilgisinin yokluğunu temsil edebilmek için nullable olur. Başlık, kurum ve belge numarası korunur. Kullanıcı dosyalarına sahte URL veya Resmî Gazete kaynağı verilmez.
- `DocumentVersion`: `storedObjectId`, çıkarılmış metin nesnesinin anahtarı, çıkarıcı sürümü, doğrulama durumu, orijinal dosya adı, alınma zamanı ve çıkarma ayrıntıları eklenir. Mevcut `contentHash`, `mimeType`, `extractedText` ve benzersizlik sözleşmesi korunur.
- `DocumentLink`: Genel sohbet, kaynak çalışması, tarama çalışması ve analiz konusu ile belge sürümü arasındaki ilişkiyi tutar. Amaç ve ilişki türü açık alanlarla tutulur; denetlenmeyen serbest bir entity kimliği kullanılmaz.
- `DocumentAssetVersion`: Ana belge sürümünün eklerini ve rolünü sabitler. Var olan `DocumentAsset` kayıtları adaptör üzerinden bu görünüme alınır.
- `DocumentImport`: Dosya veya URL alma işleminin durumunu ve idempotency anahtarını tutar. Depolama tamamlanmadan belge analiz için hazır sayılmaz.
- `SourceCoverage`: Kaynak, tarih aralığı, profil sürümü, tarih politikası, sayfalar, eksik sayfalar, kapsam durumu ve bağlantılı keşif görevini tutar.

Yeni belge ve görev kayıtları mevcut uygulamanın gerçek aktör ve erişim kapsamını taşır. Tek çalışma alanıyla başlansa bile dosya erişimi yalnızca kullanıcı tarafından gönderilen kimliğe güvenmez. Kimlik doğrulama entegrasyonu netleşmeden yeni endpointler kullanıcılar arasında sınırsız arşiv erişimiyle açılmaz.

İçerik hash değeri eşitliği kaynak kimliği, yayın tarihi veya erişim hakkı eşitliği değildir. Fiziksel deduplikasyon ayrı, mantıksal belge ilişkisi ayrı tutulur. Kullanıcıya başka bir erişim kapsamındaki dosyanın varlığı gösterilmez.

### Analiz ve rapor bağlamı

`TopicProcess` analiz konusunun kimliği olarak korunur. Mevcut kayıtların kimlikleri ve ilişkileri değiştirilmez. Yeni kayıtlar için `origin`, isteğe bağlı `scanRunId`, isteğe bağlı eski `documentId` ve `primaryDocumentVersionId` eklenir. Eski tarama konuları mevcut `CollectedDocument` ilişkisini kullanmaya devam eder. Yeni bağımsız konular sürümlü belge ilişkisini kullanır.

`AnalysisInput` bir topic için ana belge, ek belge, önceki belge ve Tariff kanıt sürümlerini açıkça bağlar. Veritabanı kısıtı eski belge ilişkisi ile yeni ana belge ilişkisini tutarlı kılmalıdır. Birden fazla girdi aynı topic altında analiz edilebilir; ana belge tek olmalıdır.

`AnalysisRevision`, `EvidenceBundle`, `ReportDraft`, `ReportFieldEdit` ve `ReportRevision` yeniden kullanılır. `TopicReport.scanRunId` bağımsız raporlar için nullable hale gelir. Silme davranışı eski çalışma silindiğinde bağımsız belgeleri veya yayımlanmış yeni arşiv kayıtlarını kaybettirmeyecek biçimde gözden geçirilir.

Analiz ve rapor şemalarına sürümlü genel kaynak bağlamı eklenir: köken, kaynak sınıfı, URL varsa gerçek URL, belge tarihi varsa belge tarihi ve ayrı alınma tarihi. Eski gazete tabanlı şemalar geriye uyumlu okunur. Kullanıcı yüklemesi `USER_PROVIDED` kaynak sınıfındadır; dosya adına, içeriğine veya model yanıtına bakılarak resmî kaynak sayılmaz. Doğrulanmış bir resmi kaynağa ilişkilendirme, kaynak deposundaki gerçek provenance üzerinden yapılır. Yükleme tarihi yayın veya yürürlük tarihi yerine kullanılmaz. Rapor sıralama tarihi ile kaynak tarihi ayrı alanlar olarak sunulur.

### Görevler

- `OperationRequest`: Kullanıcının veya otomasyonun isteği, aktör, chat mesajı veya otomasyon çalışma kimliği, kapsam, çalışma seçeneği ve planlanan görevler.
- `OperationTask`: İşlem türü, doğrulanmış parametreler, görev bağımlılıkları, girdi imzası, durumu, hata kategorisi ve sonuç referansları.
- `OperationAttempt`: Deneme numarası, lease sahibi, süreler, sağlayıcı istek kimliği ve maliyet bilgileri.
- `OperationArtifact`: Belge sürümü, analiz sürümü, taslak, Tariff çıktısı veya kapsam çıktısına türü belirlenmiş referans.
- `OperationOutbox`: Görev kaydıyla aynı PostgreSQL transaction içinde oluşur; RabbitMQ yayını ayrı teslim adımıdır.
- `ChatTaskLink`: İş isteğini genel chat mesajına bağlar. Rapor revizyonlarının mevcut ayrı denetim geçmişi korunur.

İşlem durumu `QUEUED`, `RUNNING`, `WAITING_INPUT`, `BLOCKED`, `SUCCEEDED`, `FAILED` veya `CANCELLED` olur. Birleşik istek ayrıca `PARTIAL` olabilir. Boş ama tamamlanmış keşif `SUCCEEDED` ve sıfır sonuçtur; erişilemeyen kaynak başarılı boş sonuç sayılmaz.

## Belge ekleme ve yükleme

Belge seçici chat mesaj alanında, belge arşivinde ve rapora ek kanıt ekranında ortak Ant Design bileşeni olarak kullanılır. Üç sekme bulunur: Dosya yükle, Bağlantı ekle, Arşivden seç. İsteğe bağlı metin ekleme aynı kayıt sözleşmesini kullanır.

Dosya yükleme sırası:

1. Sunucu akış halinde alır; bütün dosyayı sınırsız biçimde belleğe yüklemez.
2. Boyut, içerik imzası ve MIME türü doğrulanır; uzantı tek başına yeterli değildir.
3. Dosya MinIO içinde geçici anahtara yazılır; hash ve byte sayısı hesaplanır.
4. Kalıcı `StoredObject`, belge sürümü ve import kaydı tutarlı biçimde tamamlanır.
5. Metin çıkarma görevi oluşturulur. Chat, belgeyi alındı veya işleniyor durumuyla gösterir.
6. Çıkarılmış metin, tablo ve sayfa referansları saklanır; belge okunabiliyorsa hazır olur.
7. Kullanıcı belgeyi seçer ve analiz talimatını gönderir. Seçili belge sürümleri mesajla sabitlenir.

Başlangıç limit önerisi dosya başına 20 MB ve bir seçimde 10 dosyadır. Limitler sunucu yapılandırmasıdır; mevcut model bağlam sınırını aşan kanıtlar sessizce kesilmez. Sunucu açık hata veya bölüm seçimi sunar. Bu sayılar kullanıcı tarafından belirlenmiş mevcut limitler değildir.

PDF metin çıkarma mevcut PDF yardımcılarıyla, DOCX ve XLSX içeriği mevcut kütüphanelerle işlenir. CSV ve TXT açık karakter kodlamasıyla işlenir. Görseller için mevcut çok modlu model girdisi kullanılabilir. Tarama PDF ve görsel OCR bağımsız `EXTRACT` alt türüdür; OCR sağlayıcısı seçilmeden destekleniyor denmez. İlk teslimde bu dosyalar açıkça “metin çıkarılamadı” veya “OCR gerekli” durumunda tutulabilir; çok modlu analiz mevcut sağlayıcı desteği ve veri politikasına göre ayrıca çalıştırılır.

Şifreli PDF, bozuk Office dosyası ve desteklenmeyen türler gerekçeli durum döndürür. DOCX/XLSX için sıkıştırılmış dosya açma sınırı uygulanır. Yüklenen dosya yürütülmez; HTML içerikleri etkin kod olarak görüntülenmez. Depolanan özgün dosya çıkarma başarısız olduğunda kaybolmaz.

HTTPS ekleme mevcut URL ve yönlendirme doğrulamasını kullanır. Tek URL alma bir kaynağın günlük kapsamını tamamladığı anlamına gelmez. Arşivden seçme dosya yüklemez ve yeniden indirme başlatmaz; seçilen sürüme ilişki ekler.

Dosyanın başlığı ve bilinen yayın tarihi kullanıcı tarafından girilebilir. Bu metadata düzeltmesi özgün baytları değiştirmez. Aynı belgenin yeni dosyası yeni bir `DocumentVersion` oluşturur. Mesaj, analiz ve rapor eski sürüme bağlı kalır.

Belge ekleme ile dış AI sağlayıcısına gönderme ayrı işlemlerdir. Seçili belge kapsamı, kullanılacak model ve çalışma alanının veri politikası analiz başlatılırken uygulanır. Sırf yükleme yapılması dış sağlayıcıya gönderim anlamına gelmez.

## API sözleşmeleri

Aşağıdaki yollar önerilen uygulama sözleşmeleridir; henüz mevcut endpoint olarak sunulmaz.

| Endpoint | İşlev |
| --- | --- |
| `POST /api/v1/documents/uploads` | Streaming multipart yükleme ve import kaydı. |
| `POST /api/v1/documents/imports` | HTTPS veya kullanıcı metninden import. |
| `GET /api/v1/documents` | Kaynak, köken, tarih, metin durumu ve başlıkla sayfalı arama. |
| `GET /api/v1/documents/:id` | Metadata, sürümler ve erişilebilir ilişkiler. |
| `GET /api/v1/document-versions/:id/content` | Sayfalı veya bölüm bazlı çıkarılmış metin. |
| `GET /api/v1/document-imports/:id` | Yükleme ve çıkarma durumu. |
| `POST /api/v1/chat/sessions/:id/documents` | Erişilebilir belge sürümlerini sohbete bağlama. |
| `POST /api/v1/operations/plan` | Kayıtları ve eksikleri değerlendirip çalışacak görevleri döndürme; çalıştırma yapmaz. |
| `POST /api/v1/operations` | Doğrulanmış işi kalıcılaştırıp kuyruğa alma. |
| `GET /api/v1/operations/:id` | Görevler, sonuçlar, yeniden kullanılan çıktılar ve eksikler. |
| `POST /api/v1/operation-tasks/:id/retry` | Aynı girdilerle başarısız görevi yeniden deneme. |
| `POST /api/v1/operations/:id/cancel` | Henüz başlamamış işleri iptal; yürüyen görev için iptal isteği. |
| `GET /api/v1/automations/:id/runs` | Otomasyon çalışmalarının sayfalı geçmişi. |

Yazma çağrıları aktör ve idempotency anahtarı taşır. Aynı anahtarla farklı payload gönderilirse `409` döner. Geçerli istek kaydı ve outbox transaction içinde oluşmadan `202` dönülmez. Eksik ön koşul `422`, görünmeyen kayıt `404`, sürüm çakışması `409`, boyut aşımı `413` olur.

Örnek iş isteği:

```json
{
  "operation": "ANALYZE",
  "mode": "FILL_MISSING",
  "documentVersionIds": ["version-a", "version-b"],
  "instruction": "Değişiklikleri ve firmalara etkilerini karşılaştır",
  "enrichment": { "tariff": false },
  "createReport": false
}
```

Şablonla rapor üretme ayrı istektir. Girdisinde `analysisRevisionId`, `templateId` ve şablon sürümü bulunur; `publish` varsayılan olarak false olur. İşlem planındaki bir adımın çalıştırılması diğer adımları örtük olarak açmaz.

Mevcut sohbet mesaj şeması `content` yanında `documentVersionIds` ve isteğe bağlı açık işlem bağlamı kabul edecek biçimde genişletilir. Dosya baytları SSE mesaj isteğinin içine veya model araç parametrelerine konmaz.

## Chat araçları ve davranışları

Okuma araçları genişletilir: otomasyonları listele, otomasyon çalışmasını getir, çalışma adımlarını getir, belge sürümlerini ara, belge içeriğini getir, işlem durumunu getir, analiz ve rapor sürümlerini getir. K6 ve çalışma dışı raporlar da aynı aramada bulunur. Kaynağın gerçek yayın tarihi ile otomasyon hedef tarihi ayrı filtrelerdir.

İşlem araçları ortak operation servisine gider: kapsam eksiklerini tamamla, seçili belgeyi getir, metin çıkar, filtrele, önceki kaynakları bul, GTİP sorgula, analiz et, rapor taslağı oluştur ve taslağı düzenle. Model bu araçların doğrulanmış parametrelerini seçebilir; doğrudan Prisma, SQL, nesne anahtarı veya keyfi kuyruk komutu gönderemez.

“Bugünkü otomasyon neden çalışmadı?” bir okuma talebidir. Otomasyon ayarı, planlanan saat, çalışma kaydı ve adım hataları okunur; yalnızca rapor listesiyle cevap verilmez. “8 Ekim’de eksik kalan belgeleri getir” kapsam tamamlama talebidir. “Bu PDF’den rapor oluştur” seçili dosyanın sürümünü analiz ve rapor görevlerine bağlayan birleşik istektir.

Türkçe tarih çözümleme `scan-intent.ts` ve `report-query.ts` içinde ayrı ayrı büyütülmez; tek modüle taşınır. Türkiye saati kullanılır. Açık yıl aynen korunur; yayın tarihi bilinmeyen belgeye kullanıcının söylediği gün sessizce atanmaz. Birden çok kaynak veya belge eşleşmesi varsa seçim istenir.

Dört model turu sınırı uzun bir otomasyonu chat bağlantısında yürütmek için artırılmaz. Asistan kalıcı işi başlatır ve işlem bağlantısını döndürür. Chat bağlantısı kopsa da kabul edilmiş iş devam eder. İş tamamlandığında mesajdaki görev kartı sunucu durumundan güncellenir; tamamlanmamış iş tamamlandı diye anlatılmaz.

AI erişimi yokken deterministik otomasyon ve belge sorguları, işlem durumu, açık tarihli eksik veri alma komutları çalışabilir. Analiz gerektiren işler açık sağlayıcı hatasıyla durur. Belge içeriğindeki talimatlar işlem başlatma yetkisi vermez.

## Yürütme ve yeniden kullanım

Görev sonucu anahtarı; işlem türü, erişim kapsamı, sıralanmış belge sürümleri, kaynak veya profil sürümü, tarih politikası, semantik parametreler, prompt/model/çıkarıcı sürümleri ve gerekiyorsa şablon anlık kopyasından türetilir. Aynı belgeye farklı talimatla üretilen analizler aynı sonuç sayılmaz.

RabbitMQ en az bir kez teslim yapabilir. Sunucu aynı işin tekrar tesliminde aynı sonucu döndürmelidir. Task lease ve deneme numarası eski worker sonucunun yeni denemeyi ezmesini engeller. Outbox yayını ile iş kaydı birbirinden kopuk bırakılmaz.

Geçici ağ ve sağlayıcı yoğunluk hataları sınırlı tekrar denenir. Yetki, hesap, doğrulama ve girdi hataları otomatik tekrar döngüsüne girmez. Her başarılı aşama kendi çıktısını saklar. Worker indirme sonrasında çökerse sonraki deneme arşivlenmiş sürümü kullanır. Dış AI çağrısının sonucunun belirsiz kaldığı durumda maliyet ve belirsizlik kaydedilir; sağlayıcının desteklemediği bir tam olarak bir kez çağrı garantisi verilmez.

İptal edilmiş veya eski lease sahibinin görevi sonuç yayımlayamaz. Bir adımın yeniden çalışması önceki raporu değiştirmez. Yeni çıktı eski sürüme dayanan raporları “daha yeni analiz mevcut” olarak işaretleyebilir; otomatik yeniden yayımlamaz.

## Tarihli eksikleri tamamlamanın anlamı

Eksiklik yalnızca belge sayısının sıfır olmasıyla belirlenmez. Kaynak kapsamı, ziyaret edilen sayfalar, tarih filtresi, profil sürümü, indirilemeyen belge ve ekler değerlendirilir.

| Kayıt durumu | İşlem |
| --- | --- |
| Kapsam tamamlanmış ve sıfır belge bulunmuş | Tamamlanmış boş sonuç döndür; otomatik yeniden tara deme. |
| İstenen gün hiç keşfedilmemiş | `FILL_MISSING` altında keşif oluştur. |
| Liste kısmen okunmuş | Yalnızca eksik sayfaları veya gerekiyorsa aynı kapsamı yeniden keşfet. |
| Belge baytları eksik | Yalnızca `CAPTURE` çalıştır. |
| Belge var fakat metin çıkarılmamış | Yalnızca `EXTRACT` çalıştır. |
| Belge ve metin var fakat analiz yok | Yalnızca `ANALYZE` ve açıkça istenen zenginleştirmeyi çalıştır. |
| Analiz var fakat rapor taslağı yok | Yalnızca `BUILD_REPORT` çalıştır. |
| Kaynak geçmiş günleri sunmuyor | Kapsamı eksik veya desteklenmiyor olarak bildir; “değişiklik yok” sonucu üretme. |

Yayın tarihi bulunmayan belgeler tarihli resmi yayın kümesine katılmaz. `NEW_OR_CHANGED` politikası ile alınma zamanı üzerinden ayrı bir kapsamda bulunabilir. Aynı URL değişirse yeni içerik sürümü oluşturulur; `FILL_MISSING` tamamlanmış ve güncellik koşullarını karşılayan kaynakları gereksiz yere tekrar indirmez.

## Ekran değişiklikleri

- Chat mesaj alanına ortak belge ekleme düğmesi, dosya listesi, yükleme durumu, seçili belge sürümü ve kaldırma işlemi eklenir.
- Bir mesajın belge seçimini kaldırmak arşiv dosyasını silmez. Mesaja bağlanmış eski sürüm yeniden analizde açıkça seçilmedikçe değişmez.
- Belge arşivi için arama, köken ve tarih filtreleri, sürümler, metin önizlemesi ve hazır olma durumu sunulur.
- İşlem menüsü “Kayıtlı veriyi kullan”, “Eksikleri tamamla” ve “Yeniden çalıştır” seçeneklerini işlemin kapsamıyla birlikte gösterir.
- Otomasyon ayrıntısında her adımın girdisi, çıktısı, hata ve bağımsız tekrar deneme düğmesi bulunur.
- Analiz ekranından şablon seçilerek rapor taslağı oluşturulur. Mevcut Rapor düzelt paneli bu taslağı açar.
- Yeni görev kartı aynı hata mesajını hem transcript hem genel uyarıda tekrar göstermez.
- Aynı amaçlı düğmeler ortak bileşen olur. Dashboard ve Raporlar tarama başlat düğmelerinin mevcut ortak görünümü korunur.
- Logo, kurumsal başlık, açıklamalar ve alt bilgiler sabittir. İçerik alanlarını düzenleme sunucuda da aynı kısıtlarla uygulanır.

## Uygulama görevleri ve sıra

Her görev kendi kabul ölçütleri geçtikten sonra tamamlandı olarak işaretlenir. Yazılım geliştirme görevleri bu planın hazırlanmasından ayrı yürütülür.

### Görev 1 Sözleşmeler ve geçiş eşlemesi

- [ ] `operations/domain` altında görev türleri, durum geçişleri ve çalışma seçenekleri tanımlanır.
- [x] Kayıtlı veriyi kullanma ve eksik tamamlama kuralları saf fonksiyonlarla uygulanır.
- [ ] Aktör ve erişim kapsamının sunucuda çözülme sözleşmesi sabitlenir; yükleme, belge okuma ve işlem başlatma aynı erişim kontrolünü kullanır.
- [ ] `documents/domain` altında belge kökeni, sürüm ve import sözleşmeleri yazılır.
- [ ] Eski `CollectedDocument`, `SourceScanDocument`, `ManagedSource` ve `Document` kimlikleri için eşleme tablosu hazırlanır.
- [ ] Analiz ve rapor genel kaynak şemalarının geriye uyum sözleşmesi sabitlenir.

Kabul: Aynı gün için sıfır sonuç, hiç taranmamış kapsam ve başarısız tarama farklı plan üretir. Yeni planlayıcı eski tablo kimliklerini karıştırmaz.

### Görev 2 Veritabanı ve arşiv değişiklikleri

- [x] `schema.prisma` belgeler, sürümler, ilişkiler, görevler ve outbox için genişletilir.
- [ ] Topic ve rapor ilişkileri bağımsız analizleri destekleyecek biçimde genişletilir.
- [x] Yeni indeksler; kaynak/tarih, belge sürümü/hash, işlem/durum, istek/idempotency ve görev/girdi imzası sorgularını kapsar.
- [x] Migration ayrı test veritabanında çalıştırılır; mevcut rapor ve analiz sayıları korunur.
- [x] Tarihi kayıtlarda eksik alanlar nullable tutulur; bilinmeyen değerler uydurulmaz.

Kabul: Migration öncesi kayıtlar aynı kimliklerle açılır. Dosya ve bağımsız analiz kaynak olmadan, yayın tarihi bilinmeden kaydedilebilir.

### Görev 3 Görev servisi ve worker

- [ ] `operations/application/plan-operation.ts`, `start-operation.ts` ve `execute-operation-task.ts` eklenir.
- [ ] `operations/infrastructure/prisma-operation-repository.ts` ve outbox dispatcher eklenir.
- [x] RabbitMQ queue allowlist ve `worker.ts` yeni operation kuyruğunu tanır.
- [ ] Mevcut `BackgroundJob` lease sistemi ile task denemesi bağlanır.
- [x] İptal, tekrar deneme, bağımlılık çözümü ve kısmi sonuç durumları uygulanır.

Kabul: Tekrarlanan HTTP isteği ve kuyruk teslimi aynı işi çoğaltmaz. Worker çökmesi başarılı önceki adımı kaybettirmez.

### Görev 4 Belge yükleme ve import

- [x] `documents/documents.routes.ts`, import şemaları ve streaming multipart desteği eklenir.
- [ ] Dosya doğrulama, hash, depolama ve tamamlanmamış import temizleme uygulanır.
- [x] `import-document.ts` dosya, URL ve kullanıcı metni için ortak kayıt üretir.
- [ ] `link-document.ts` sohbet ve analiz bağlarını kurar.
- [x] Arşivden seçme ve dosyanın yeni sürümünü yükleme desteklenir.

Kabul: Aynı dosyanın yeniden eklenmesi aynı baytları tekrar depolamaz; uygun kapsamda ilişki ekler. Başarısız çıkarma dosyayı silmez. Yükleme kendiliğinden AI çağırmaz.

### Görev 5 Metin ve tablo çıkarma

- [x] `extract-document.ts` MIME türüne göre mevcut yardımcıları çağırır.
- [x] PDF sayfa, DOCX paragraf, XLSX sayfa/hücre ve CSV satır referansları saklanır.
- [x] Office sıkıştırma ve toplam çıkarılmış içerik sınırları uygulanır.
- [x] Görsel ve tarama PDF için okunabilir durum ve OCR ihtiyacı ayrılır.
- [x] Chat belge okuma aracı PDF metnini de arşivden alabilir.

Kabul: Metin çıkarma kendi başına çalışır; scraping ve rapor üretimi başlatmaz. Desteklenmeyen dosya türü açık durum döndürür.

### Görev 6 Keşif ve indirmeyi ayırma

- [ ] `source-scan-run.ts` içindeki keşif, capture, validation ve processing blokları bağımsız yürütücülere ayrılır.
- [x] `source-collector.ts` profillerinin mevcut davranışı korunur.
- [x] `SourceCoverage` üzerinden tarihi kapsam ve eksik sayfalar kaydedilir.
- [x] Belge ve ek dosyalar ayrı başarı durumlarıyla işlenir.
- [x] Resmî Gazete ve dış kaynaklar ortak operation sözleşmesine adaptörlerle bağlanır.

Kabul: Yalnızca scraping talebi analiz çalıştırmaz. Tarih dışındaki belgeler ilgili güne taşınmaz. İndirilemeyen tek ek bütün başarıları silmez.

### Görev 7 Filtre ve önceki kaynak görevleri

- [x] Filtre girişi seçilmiş belge sürümleri veya mevcut run adaptörü olabilir.
- [x] Önceki kaynak keşfi kendi çıktı ve görev kimliğine sahip olur.
- [x] Kullanıcının doğrudan analiz ettiği belge filtre OUT olduğu için sessizce engellenmez; kapsam durumu açıklanır.
- [ ] Mevcut retry endpointleri yeni işlem türlerine doğru biçimde yönlendirilir.

Kabul: Filtre, önceki kaynak ve analiz farklı görevlerdir; yalnızca filtre çalıştırıldığında rapor oluşmaz.

### Görev 8 Tariff görev ve kanıt kaydı

- [x] Mevcut lookup servisinin sonucu sürümlü artifact olarak kaydedilir.
- [x] GTİP, tarih ve menşe sunucuda doğrulanır.
- [x] Sorgu tarihindeki önlemler ile önceki tarih karşılaştırması korunur.
- [x] Tariff kanıtı seçili analiz paketine bağlanabilir.

Kabul: Tariff hesabı kullanılamıyorsa gerçek durum bildirilir. Kullanıcı özel bir kod söylediğinde model farklı kodla sorgu yapamaz. Bir sorgu sonucu kendiliğinden rapor yayımlamaz.

### Görev 9 Çalışmadan bağımsız analiz

- [ ] `execute-topic-analysis.ts` çekirdeği genel `AnalysisInput` bağlamıyla çağrılır.
- [ ] Eski topic kanıtını okuyan adaptör mevcut akışı korur.
- [ ] `build-evidence-bundle.ts` yüklenen belge sürümlerini, ekleri ve Tariff çıktılarını kabul eder.
- [x] Analiz revizyonu, kanıt imzası, model/prompt sürümü ve sağlayıcı hataları kaydedilir.
- [x] Çok belgeli analizde belge rolleri ve çelişkiler çıktı şemasında görünür olur.

Kabul: Yüklenen belge analiz edilirken gazete edition veya sahte tarama kaydı gerekmez. Yeniden analiz aynı baytları yeniden indirmez. Çıktı gerçek belge/sayfa referanslarına bağlıdır.

### Görev 10 Analizden bağımsız rapor taslağı

- [ ] `build-report-draft.ts` kayıtlı analiz sürümünü okuyup spec oluşturur.
- [x] Şablon içeriği işlem başında sabitlenir; sonradan değişen şablon eski raporu etkilemez.
- [x] Rapor üretiminde AI çağrısı gerekmeyen kısımlar deterministik renderer kullanır.
- [x] Çalışma dışı raporlar Raporlar listesinde ve chat aramasında görünür.
- [ ] Mevcut düzenleme, sürüm çakışması, yayımlama ve geri alma yolları bağlanır.

Kabul: Taslak üretmek analiz veya scraping çalıştırmaz. Logo tek kez görünür; taslak yayımlanana kadar eski rapor değişmez. K6 yalnızca tamamlanmış ve uygun kapsamdan üretilir.

### Görev 11 Otomasyonları ortak görevlere taşıma

- [ ] `workspace/automations.ts` otomasyon ayarını adım planına dönüştürür.
- [ ] Kaynak, tarih politikası, filtre, zenginleştirme ve şablon ayarları çalışma başlangıcında sabitlenir.
- [ ] İşlem adımları görev sonuçlarıyla eşlenir; eski run ayrıntıları okunabilir kalır.
- [x] Bir adımın tekrar denemesi parent START_SCAN çağrısına dönüşmez.

Kabul: Otomasyon ve manuel analiz aynı yürütücüyü kullanır. “Yalnız analiz” ve “yalnız belge alma” ölçülen çağrı sayılarıyla bağımsızdır.

### Görev 12 Chat sorguları ve işlem araçları

- [x] `AssistantKnowledge` otomasyonlar, çalışma adımları, K6, bağımsız belgeler ve görevler için genişletilir.
- [x] Ortak Türkçe tarih çözümleyicisi eklenir.
- [x] `ChatOperations` servisi model araçlarını operation use-case katmanına bağlar.
- [x] Mesaj şeması seçili belge sürümlerini kabul eder.
- [x] Araç sonuçları kaynak, tarih, işlem durumu ve sonuç bağlantıları taşır.
- [x] AI olmadan yapılabilen kayıt sorguları deterministik yoldan sürer.

Kabul: Okuma isteği yeni tarama oluşturmaz. “Bugünkü otomasyon neden çalışmadı?” doğru otomasyon adımının hatasını döndürür. Uzun işlem tek SSE bağlantısına bağlı değildir.

### Görev 13 Ortak ekran bileşenleri

- [x] `DocumentPicker`, `DocumentAttachmentList`, `OperationModeSelect` ve `OperationTaskCard` oluşturulur.
- [x] Chat, belge arşivi, otomasyon ayrıntısı ve rapor ek kaynak ekranı bu bileşenleri kullanır.
- [x] Belgeye sürüm ve durum etiketi eklenir; yükleme/çıkarma hatası tek yerde görünür.
- [x] İşlem ilerlemesi yeniden yükleme sonrası server kayıtlarından geri gelir.
- [ ] Dar ekran, klavye ile kullanım ve mevcut mor tema kontrol edilir.

Kabul: Belgeler chat’e eklenir, çıkarılır ve tekrar seçilir. Seçili belge sürümü mesajdan sonra değişmez. Aynı amaçlı düğmeler aynı ortak görünüme sahiptir.

### Görev 14 Geçiş ve uçtan uca teslim

- [x] Yeni alanlar ve modüller önce mevcut davranışı değiştirmeden eklenir.
- [x] Eski arşiv metadata eşlemesi sayfalı, yeniden başlatılabilir ve idempotent backfill ile yapılır.
- [x] Eksik baytlar veya tarih kayıtları backfill sırasında uydurulmaz.
- [ ] Önce manuel yeni işlemler, sonra chat, ardından otomasyon adaptörleri etkinleştirilir.
- [x] Bekleyen eski kuyruk mesajları eski şemayla işlenebilir; aynı iş iki motor tarafından yürütülmez.
- [x] Operasyon dokümantasyonu, hata giderme ve geri dönüş adımları eklenir.

Kabul: Eski otomasyon ve raporlar çalışır. Yeni özellikler kapatıldığında eski yollar kullanılabilir; yeni belgeler ve sonuçlar kaybolmaz.

Bağımlılık sırası: Görev 1 ve 2 → 3 ve 4 → 5 ve 6 → 7 ve 8 → 9 → 10 → 11 ve 12 → 13 ve 14. Belge seçici ekranı, upload sözleşmesi sabitlendiğinde tasarlanabilir; gerçek iş akışı hazır olmadan tamamlandı sayılmaz.

## Dosya yerleşimi

Yeni backend modülleri `backend/src/modules/documents/` ve `backend/src/modules/operations/` altında domain, application, infrastructure ve routes ayrımıyla oluşturulur. Yeni saf tarih çözücü chat application katmanında tutulur. Mevcut source, tariff ve topic modülleri taşınmadan adaptörlerle çağrılır.

Yeni frontend belge ekranları `frontend/src/features/documents/`, ortak işlem ekranları `frontend/src/features/operations/` altında oluşturulur. `ConversationComposer.tsx`, `ChatScreen.tsx`, `workspace/AutomationPages.tsx`, `SourceRunDetail.tsx` ve mevcut rapor çalışma alanı bu bileşenlere bağlanır.

Yeni migration adları uygulama anındaki zaman damgasıyla oluşturulur. Bu planda mevcut olmayan dosya yolları önerilen dosyalardır. Eski kodun tamamını yeniden yazmak bir görev değildir.

## Doğrulama matrisi

| Test | Beklenen kanıt |
| --- | --- |
| Aynı upload iki kez | Tek bayt arşivi; doğru kapsamda tekrar kullanılabilir sürüm ve ilişki. |
| Upload sırasında bağlantı kesilmesi | Tamamlanmamış import; analiz edilebilir belge gibi görünmez. |
| Dosya uzantısı ve MIME uyuşmazlığı | Gerekçeli doğrulama hatası. |
| Boş veya şifreli PDF | Okunamama durumu; uydurulmuş metin veya analiz yok. |
| Belge seçiminden sonra yeni sürüm yükleme | İlk mesaj ve analiz eski sürüme bağlı kalır. |
| Tamamlanmış sıfır belge günü | Eksik tarama veya başarısız kaynak gibi sunulmaz. |
| Belirli günün eksik tek belgesi | Başarılı diğer belgeler yeniden indirilmez. |
| Yalnız scraping | AI ve report renderer çağrı sayısı sıfır. |
| Yalnız analiz | Kaynak oturumu, discovery ve capture çağrı sayısı sıfır. |
| Yalnız rapor taslağı | AI, discovery ve capture çağrı sayısı sıfır. |
| Model veya prompt değişimi | İlgili analiz önbelleği yeniden kullanılmaz; dosya baytları tekrar indirilmez. |
| İdempotency anahtarı aynı fakat payload farklı | `409`, yeni görev yok. |
| İki worker aynı görevi alır | Tek geçerli lease ve tek yayımlanmış sonuç referansı. |
| Worker başarılı adım sonrasında kapanır | Sonraki deneme başarı çıktısını yeniden kullanır. |
| Chat bağlantısı kapanır | Kabul edilmiş görev izlenebilir biçimde devam eder. |
| Google AI yetki hatası | DB sorgusu çalışır; analiz görevi açık sağlayıcı hatası döndürür. |
| Tariff hesabı yok | Sorgu kullanılamıyor; sahte GTİP sonucu yok. |
| Otomasyon sorusu | Doğru otomasyon, saat ve adım hatası kaynak gösterilir. |
| Rapor taslağına eski sürümle kayıt | Sürüm çakışması; mevcut rapor korunur. |
| Şablonun logo veya CSS alanını değiştirme denemesi | Sunucu sabit kurumsal iskeleti korur. |
| Yüklenen belgede model talimatı | Veri olarak kalır; yeni işlem başlatmaz. |
| Yetkisiz belge sürümünü seçme | İçerik ve nesne anahtarı açığa çıkmaz. |
| Yeni model migration ve backfill | Eski run, analiz ve rapor kimlikleri korunur. |

Birim testleri ağ çağrısı ve canlı AI kullanmaz. Entegrasyon testleri yalnızca açık `TEST_DATABASE_URL` ile adı `_test` biten ayrı veritabanında ve ayrı MinIO bucket içinde çalışır. Mevcut `backend/test/setup.ts` koruması kaldırılmaz. Kuyruk testleri ayrı queue kapsamı kullanır. Canlı uygulamanın tarama, belge veya rapor kayıtlarını temizleyen test hazırlığı kullanılmaz.

Uçtan uca doğrulama senaryosu: kamuya açık örnek dosya yükle → metin çıkar → arşivden ikinci belgeyi seç → ortak analiz üret → isteğe bağlı GTİP kanıtı ekle → ATEZ şablonuyla taslak oluştur → yalnızca özeti düzenle → yeni sürüm yayımla → chat’ten aynı sonuçları oku. Aynı örnek sonraki çalışmada `REUSE_ONLY` ve `FILL_MISSING` seçenekleriyle tekrar edilir; gereksiz dış çağrı yapılmadığı ölçülür.

## Yayına geçiş ve geri dönüş

İlk migration öncesinde veritabanı ve nesne deposu referansları yedeklenir. Değişiklikler ekleme ve nullable alanlarla başlar; toplu silme veya eski kolonları kaldırma bu geçişin parçası değildir. Backfill önce sayım ve eşleme raporu üretir, ardından küçük partilerle uygulanır.

Yeni görev yürütücüsü, belge yükleme ve otomasyon adaptörleri ayrı özellik bayraklarıyla etkinleştirilir. Bir sorun halinde yeni işler kabul edilmez; kabul edilmiş işler kayıtlarında kalır. Eski worker mesajları ve rapor okuma yolları korunur. Yeni veri oluştuktan sonra şema geri alınarak veri kaybedilmez; gerekli durumda uygulama yolu eski sürüme döndürülür ve eklenen tablolar korunur.

Hata günlüklerinde işlem kimliği, adım, girdi sürümü ve hata kategorisi bulunur. Dosya içeriği, sağlayıcı anahtarı ve oturum bilgisi genel günlük veya chat hata yanıtına yazılmaz.

## Tamamlanma ölçütü

Belge yükleme, URL alma ve arşivden seçme gerçek kayıtlarla çalışmalıdır. Chat, manuel düğmeler ve otomasyon aynı işlem servislerini çağırmalıdır. Kullanıcı yalnızca istediği adımı çalıştırabilmeli; mevcut veri yeniden kullanılabilmeli; rapor kaynak ve sürümlerine bağlı kalmalıdır. Taslak üretiminden yayımlamaya kadar bütün sonuçlar yeniden açılabilir olmalı ve eski uygulama akışları bozulmamalıdır.

Bir endpoint veya düğmenin eklenmesi tek başına tamamlanma değildir. Veri kaydı, görev yürütme, sürüm bağlantısı, ekran, hata davranışı ve yukarıdaki kabul senaryoları birlikte doğrulanmalıdır.
