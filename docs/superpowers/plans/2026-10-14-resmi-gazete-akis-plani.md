# Resmî Gazete araştırma ve raporlama planı

Beş kaynak, ortak worker yapısı, sohbet cevapları ve dosya grupları için üst tasarım: [Beş kaynak için ortak operasyon mimarisi](2026-10-14-ortak-operasyon-mimarisi.md). Bu belge Resmî Gazete örnekleri ve kanıt işleme ayrıntılarını korur.

14 Ekim 2026. Durum: tasarım önerisi; uygulama değişikliği yapılmadı. Kapsam yalnız Resmî Gazete ve onun önceki değer araştırmasında kullanılan Tariff bağlantısıdır. Diğer dört kaynak bu aşamada genişletilmeyecek. Ortak modüllere yapılacak değişikliklerin diğer kaynakları bozmaması ayrıca test edilecek.

Amaç, bütün resmî belgeleri ve eklerini hesap verebilir biçimde işleyen, filtreleme sırasında araştırma ihtiyacını belirleyen, önceki kaynağı bulabilirse karşılaştıran, bulamazsa bunu açıkça belirterek mevcut belgeyi raporlayan tek bir üretim akışı kurmaktır. Kullanıcı her belge için hangi kaynakların okunduğunu, hangi isteğin yapıldığını ve rapordaki bilginin nereden geldiğini görebilmelidir.

## 1 Tarih ve kaynak kuralı

Kullanıcının belirlediği varsayılan karşılaştırma **yayın öncesi durum ile yeni yayımlanan düzenleme** arasındadır.

11 Temmuz örneği:

| Alan | Değer veya kaynak |
|---|---|
| Yeni belge | 11 Temmuz 2026 tarihli resmî belge ve ekleri |
| Eski durum tarihi | 10 Temmuz 2026 |
| Tariff isteği | queryDate=2026-07-10 |
| Yeni değer | Tariff'ten yeniden aranmaz; mevcut resmî belgeden alınır |
| Yürürlük | Belgenin yürürlük maddesinden ayrı çıkarılır; bu örnekte analiz kaydında 10 Ağustos 2026 |
| Rapor ifadesi | 10 Temmuz'daki durum ile 11 Temmuz'da yayımlanan yeni düzenleme karşılaştırılır; uygulamaya başlama tarihi ayrıca gösterilir |

11 Temmuz'da yayımlanmış olması, yeni değerin 11 Temmuz'da yürürlükte olduğu anlamına gelmez. Yayın tarihi, önceki durum tarihi ve yürürlük tarihi birbirinin yerine kullanılmaz. Sonradan özel bir “yürürlük öncesi durum” incelemesi istenirse ayrı tarih politikasıyla yapılabilir; varsayılan akışı değiştirmez.

Tariff'ten yalnız eski durum istenir. Mevcut istemcide bunu temsil eden çağrı `lookup({code, date: previousAsOfDate, compare: false})` biçimindedir. Çıktıdaki `current` alanı bu durumda sorgulanan tarihsel durumdur; yeni sözleşmede bunun adı `snapshot` olmalıdır. İç içe ikinci bir tarihsel karşılaştırma başlatılmamalıdır.

## 2 Doğrulanmış mevcut sorunlar

İncelenen rapor: `98c3ea58-fa0e-4ff3-9135-440ae4cfec56`; çalışma: `557f2615-f3be-478f-8164-088ea4addbc9`. Bulgular saklanan manifest, analiz, HTML, Tariff sonuçları ve mevcut çalışma ağacından alınmıştır. Kod ağacında önceden yapılmış çok sayıda değişiklik vardır; mevcut dosyalar ile çalışan süreçlerin tüm sürümlerinin eşit olduğu varsayılmayacaktır.

| Bulgu | Sonuç | İlgili kod |
|---|---|---|
| Tariff'e targetDate gönderiliyor | Yayın öncesi gün yerine 11 Temmuz sorgulanmış | `enrich-with-tariff.ts` |
| İstemci varsayılan olarak kendi tarihsel karşılaştırmasını yapıyor | 6910 satırlarında 29 Ocak ile 11 Temmuz karşılaştırılmış | `tariff-lookup.ts` |
| Tariff model bağlamı 120.000 byte ile sınırlandırılıyor | İlk iki yaklaşık 48 KB yanıt modele eklenmiş, diğer beşi eklenmemiş; hepsi arşivde mevcut | `enrich-with-tariff.ts` |
| Bu sınır nedeniyle atlanan sonuçlar için ayrı kapsam uyarısı yok | Arşivlenen veri ile modelin gördüğü veri farklı | aynı dosya |
| Tariff zenginleştirme hatasında genel catch temel kanıta dönüyor | Tariff aşaması görünür hata üretmeden kaybolabilir | `execute-topic-analysis.ts` |
| Önceki kaynak HTML metni ilk 12.000 karakterle sınırlı | Sonraki maddelerdeki değişiklik hedefleri kaçabilir | `previous-source-prompts.ts` |
| İçerik filtresi IN veya OUT vermeye zorlanıyor | Okunamayan/belirsiz içerik için açık inceleme kararı yok | `document-filter-prompts.ts` |
| Büyük tek belge içerik sınırını aşınca hata üretiyor | Sayfa veya madde bazında işleme yok | `execute-document-filter.ts` |
| Analiz paketi byte sınırını aşınca duruyor | Aynı örnek çalışmada yaklaşık 24 ve 31 MB iki paket 8 MB sınırında kalmış | `build-evidence-bundle.ts` |
| Önceki kaynak araması ilk sayfayı alıyor | Arama sonuçlarının tümü değerlendirilmiyor | `resmi-gazete-search.ts` |
| Tek aday başlık/numara/tür/tarih puanıyla seçiliyor | Seçilen belgenin istenen maddeyi ve geçerli önceki sürümü içerdiği ayrıca kesinleştirilmiyor | `previous-source-matcher.ts` |
| K2 kartı yeni tabloyu alıyor, genel comparisons alanını taşımıyor | Analizdeki eski–yeni satırlar ayrı tabloda görünmüyor | `build-report-spec.ts` |

Bu örnekte önceki 31 Aralık 2025 PDF'si gerçekten bulunmuş ve modele verilmiştir. Analiz ve HTML özeti 4.500 → 5.500 bilgisini içerir. Dolayısıyla “önceki kaynak hiç kullanılmadı” sonucu doğru değildir.

Prototipte daha kapsamlı araştırma bileşenleri de var: `research-plan.ts`, `tariff-retrieval.ts`, `execute-research.ts`, `official-research.ts`. Önceki yanıttaki prototip açıklamasını yalnız README üzerinden değerlendirmek eksikti: araştırma yürütücüsü kodu mevcut. Buna karşılık incelenen ana `executeScanRun` hattı bu yürütücüyü çağırmıyor. Planın amacı yeni bir üçüncü yol eklemek değil, kullanılabilir parçaları tek üretim sözleşmesinde birleştirmektir.

## 3 Hedef akış

1. Günün ana ve mükerrer sayıları keşfedilir; her başlık tekil belge kimliğiyle kaydedilir.
2. Belgeler ve anlamı etkileyen ekler arşivlenir. Sayfa, madde, tablo ve ek envanteri çıkarılır.
3. İçerik okunarak **filtre kararı ve araştırma planı birlikte** oluşturulur.
4. IN belgelerin gerekli önceki kaynak işleri yürütülür; OUT gerekçeleri saklanır; eksik okunmuş belge REVIEW kalır.
5. Mevcut resmî belge, önceki kaynaklar, tam Tariff yanıtları ve araştırma sonuçları analiz girdisine bağlanır.
6. Değişiklik özelinde analiz ve karşılaştırma oluşturulur.
7. Kaynak, sayı, tarih, kapsam ve tablo kontrolleri yapılır.
8. Doğrulanmış analizden rapor üretilir; analizdeki karşılaştırmalar HTML'ye taşınır.

Başlık aşaması iş sırasını belirleyebilir; torba kanun veya genel başlıklı belgeyi içerik okunmadan kesin OUT yapmamalıdır. Kullanıcının “bütün büyük/küçük belgeler” hedefi için başlık tek başına okuma yerine geçmez. İlanlar keşif envanterinden sessizce düşürülmez; kapsam kararı ayrı gerekçeyle verilir.

Filtre ve araştırma planı aynı okumadan çıkarılır; dış kaynak sorguları bu model çağrısının içine gömülmez. Böylece belge tekrar tekrar okutulmadan ne aranacağı belirlenir, başarısız araştırma filtreyi yeniden çalıştırmadan tekrarlanabilir.

## 4 Filtreleme ve araştırma çıktı sözleşmesi

Önerilen yeni `DocumentAssessment` kaydı:

| Alan | İçerik |
|---|---|
| identity | Belge kimliği, URL, tarih, RG sayısı, mükerrer, tür, kurum |
| coverage | Beklenen ve okunan dosyalar, sayfalar, maddeler, tablolar; okunamayan parçalar |
| relevance | IN / OUT / REVIEW, kısa gerekçe, dayanak madde ve alıntı |
| changeType | Yeni düzenleme, değişiklik, kaldırma, süre, uygulama duyurusu vb. |
| amendedInstruments | Değiştirilen mevzuatın adı, numarası, madde/ek/tablo kimliği |
| effectiveRules | Yürürlük metni, kaynak konumu, çözülen tarih veya belirsizlik |
| currentFacts | Yeni belgedeki değerler, GTİP, birim, para birimi, menşe, koşul ve dipnot |
| researchNeeds | İstenen eski bilgi, neden gerektiği, rota, tarih, kod, alanlar, arama terimleri |
| provenance | Her bulgunun dosya/sayfa/madde/satır bağlantısı |
| versions | Şema, prompt, model, kaynak hash ve politika sürümü |

Bir belgenin birden fazla araştırma ihtiyacı olabilir. Örneğin aynı tebliğde GTİP kıymeti için Tariff, başvuru usulünün önceki metni için RG gerekir. Rota belgeye tek etiket vermek yerine ihtiyaç bazında belirlenir.

Filtre promptunun özü: “Bütün materyalleri oku; her belge ve bölüm için kapsamı bildir; gümrük/dış ticaret etkisini kaynakla gerekçelendir; ilgiliyse önceki hangi bilgiye ihtiyaç olduğunu yapılandırılmış biçimde çıkar; eski değer tahmin etme; eksik okuma veya belirsizlikte REVIEW kullan.”

## 5 Araştırma yönlendirmesi

| İhtiyaç | İlk işlem | Sonraki işlem |
|---|---|---|
| GTİP'e bağlı ve Tariff'in sağlayabildiği eski değer/önlem | Yayından önceki gün için Tariff sorgusu | Eksik, çelişkili, belirsiz veya hatalıysa ilgili ihtiyaç için RG araştırması |
| Eski madde, usul, süre, kapsam veya Tariff'te bulunmayan bilgi | RG filtre araması | Aday içerikleri ve ekleri okunur; gerekirse temel metin ve ara değişiklikler birleştirilir |
| Önceki kaynağa gerek yok | Araştırma atlanır ve gerekçesi kaydedilir | Mevcut belgeyle analiz |
| Araştırma tamamlandı ama önceki kaynak bulunamadı | NOT_FOUND kaydı | Eski değer uydurmadan mevcut belgeyle rapor; karşılaştırmanın yapılamadığı belirtilir |
| Kaynağa erişim hatası veya eksik arama | FAILED / INCOMPLETE kaydı | Yeniden deneme; “bulunamadı” diye gösterilmez |

Önceki kaynak bulunmaması tek başına mevcut belgenin raporunu engellemez. Mevcut resmî belge veya anlamı etkileyen eki okunamıyorsa ilgili belge raporu tamamlanmış sayılmaz. Sağlam diğer belgelerin raporları ayrı tamamlanabilir; günlük bütünlük durumu PARTIAL kalır.

Tariff isteği `code`, `queryDate`, ülke/ithalat bağlamı ve gerekiyorsa menşe taşır. İstenen alanlar ve önlem türü araştırma kaydında saklanır; sağlayıcının desteklemediği parametreler varmış gibi API'ye eklenmez. Ham yanıt aynen korunur ve analizde erişilebilir olur. Kısa GTİP otomatik sıfırla doldurularak gerçek alt kod sayılmaz; kapsam açılımı ayrı kaydedilir.

RG aramasında tek sayfa yerine sayfalama yapılır. Başlık, mevzuat numarası, kurum ve madde ihtiyacı birlikte değerlendirilir. `2018/5` aramasının `2018/5552` gibi sonuçları eşleşme sayılmaz. Yeni belge önceki aday olarak seçilemez. Arama kapsamı tamamlanmadan NOT_FOUND verilmez. Tek PDF bütün önceki hükmü vermiyorsa birden fazla resmî kaynak bağlanır.

## 6 Model bağlamı ve büyük belgeler

Kural: **Her alınan yanıt ve gerekli belge bölümü analiz sürecinde işlenir; sığmayan içerik sessizce atılmaz.** Arşivlemek, modele vermek ve modelin okuyup değerlendirdiğini doğrulamak üç ayrı kayıt olacaktır.

Küçük paket: güncel belge, bütün ekleri, varsa önceki belge ve tam Tariff yanıtları tek analiz isteğinde verilir. Kullanıcının beklediği doğrudan çalışma budur. Paket öncesinde gerçek model bağlamı, çıktı için ayrılan yer, dosya ve sayfa sınırları değerlendirilir; 120 KB sabit kesmesi kaldırılır.

Büyük paket: bütün ham yanıtlar ve belge bölümleri numaralandırılarak ayrı okuma işlerine dağıtılır. Bir tabloyu bölerken başlık, birim ve dipnot her ilgili parçaya taşınır; madde ilişkileri ve devam sayfaları korunur. Her parçanın okuma sonucu, tam kaynak referansı, sayısal bulguları ve belirsizlikleri saklanır. Birleştirme analizi bütün parça çıktılarını kapsar; ihtiyaç halinde ham parçaya geri erişir. Final model tek istekte tüm ham dosyaları gördü denmez; hangi veriyi hangi çağrının gördüğü izlenir.

Tamlık kontrolü: beklenen parça kimlikleri = başarıyla okunan parça kimlikleri. Aynı kontrol tablo satırları ve madde envanteri için de yapılır. İlk birkaç sayfadan üretilmiş özet bütün belge yerine geçmez. Tarama/OCR güveni düşük sayfalarda görsel kontrol veya yeniden okuma gerekir. PDF, görsel, HTML ve ofis eki için desteklenen dönüştürme yolu açıkça tanımlanır; desteklenmeyen format OUT olmaz.

Gemini için dosya sınırı, bağlam penceresi ve çıktı sınırı ayrı kısıtlardır. Files API'ye yüklemek sınırsız bağlam sağlamaz. Mevcut üretim istemcisinin inline PDF/görsel yolu korunabilir; model ve SDK uygunluğu doğrulandıktan sonra dosya referansı yolu eklenir. Resmî teknik referans: [Gemini belge işleme](https://ai.google.dev/gemini-api/docs/document-processing).

## 7 Analiz ve rapor promptları

Analiz için tek sürümlü temel prompt ve açık veri paketi önerilir. Görevleri:

- Mevcut belgenin neyi değiştirdiğini ve kimleri etkilediğini yalnız kanıttan çıkarmak.
- Yeni değerleri mevcut RG'den, eski değerleri tarihli önceki kaynaktan almak.
- Yayın tarihi, önceki durum tarihi ve yürürlük tarihini ayırmak.
- GTİP, menşe, koşul, birim ve para birimi uyumluysa karşılaştırmak; uyumsuzluğu açıkça yazmak.
- Eski kaynak yoksa yalnız mevcut düzenlemeyi açıklamak; artış/azalış veya yüzde uydurmamak.
- Tariff bilgisini destekleyici kaynak olarak göstermek; önceki resmî hükümle çelişkiyi gizlememek.
- Her sayısal ve hukuki iddiaya kanıt kimliği bağlamak; belge dışı genel uygulama yorumunu kanıtsız kesin hüküm olarak eklememek.

Çıktı: özet, ayrıntılı değişiklik, etkilenenler, yürürlük, bütün karşılaştırma satırları, yeni tablo, kaynaklar, eksikler ve iddia–kanıt bağlantıları. Rapor promptu yeni araştırma yapmaz veya eski değer eklemez; doğrulanmış bu çıktıyı mevcut rapor şablonuna aktarır. Sayı ve karşılaştırma eşitliği analiz ile rapor arasında programatik kontrol edilir.

Örnek rapordaki “gözetim belgesi veya yurt dışı gider beyanıyla matrah tamamlama” gibi operasyonel yorumlar ayrıca hukuki dayanak denetimine alınmalıdır; yalnız gözetim tablosu bu tür bütün uygulama sonuçlarını kanıtlamaz.

## 8 Playwright ve Gemini rolleri

Mevcut ana tarama hattında `OfficialHttpClient` ve `ResmiGazeteSearch` doğrudan HTTP kullanıyor. Prototipin `PlaywrightCollector` ve `GazetteFilter` bileşenleri tarayıcı ve tarayıcı oturumundan yapılan istekleri kullanıyor. Gemini, sağlanan materyali okuyor; ana akışta tarayıcıyı kendisi yönetiyor varsayımı doğru değil.

Önerilen tek erişim arayüzü: `GazetteClient`. Başlangıçta doğrulanmış doğrudan HTTP yolu, oturum veya sayfa çalıştırma gerektiğinde Playwright yolu kullanılır. Yöntem ve gerekçe kaydedilir. Her ikisi aynı belge paketi sözleşmesini döndürür; ayrı analiz hatları oluşturmaz.

Playwright sayfayı açar, kimliği ve bağlantıları toplar, PDF/ekleri indirir, gerektiğinde görüntü kanıtı üretir. Gemini belgeyi ve adayları sınıflandırır, alanları çıkarır ve araştırma önerir. Uygulama tarih ve adres doğrulamasını yapar, işi kuyruğa verir, yanıtı denetler. Modelin kaynak içindeki talimatlarla yeni araç kullanımı veya farklı hedeflere yönelmesi engellenir.

Tarayıcı bağlamları çalışma alanı/iş kimliğiyle izlenir; kapatma ve süre aşımı işlemleri garantilenir. Doğrudan HTTP ile tarayıcıdan yapılan isteklerin çerez davranışı farklı olabilir. [Playwright APIRequestContext](https://playwright.dev/docs/api/class-apirequestcontext) bu ayrımı açıklıyor.

## 9 RabbitMQ ile dayanıklı yürütme

Mevcut altyapı kalıcı kuyruk, yayın teyidi, prefetch(1), veritabanı iş kilidi, 90 saniyelik lease ve 30 saniyelik heartbeat içeriyor. Hatalar retry/failed kuyruklarına taşınıyor. Ana tarama hâlen çok sayıda aşamayı tek uzun iş içinde yürütüyor; ayrıca pg-boss zamanlayıcı/köprü yolları var. Bunlar kaldırılmadan önce görev sahipliği açıkça belgelenmelidir.

Öneri: RabbitMQ işi taşır, PostgreSQL gerçek aşama durumunu tutar, nesne deposu kanıtı saklar. Mesajlara PDF veya tam Tariff JSON koyulmaz; iş ve kanıt referansları konur.

Mantıksal işler: DISCOVER, CAPTURE, ASSESS_PART, MERGE_ASSESSMENT, RESEARCH, ANALYZE_PART, MERGE_ANALYSIS, AUDIT, RENDER. Her iş için fiziksel ayrı kuyruk gerekmeyebilir; kuyruk grupları kaynak indirme, model işlemi ve yayın iş yüküne göre belirlenir.

Kimlik anahtarı belge + aşama + girdi hash + politika/prompt sürümüdür. Yeniden teslim aynı çıktıyı iki kere yayımlamamalıdır. Sonuç kaydı ve sonraki işin outbox kaydı aynı veritabanı işlemiyle yazılır; mesaj kalıcı sonuçtan sonra onaylanır. Ağ hatasında yalnız başarısız parça tekrar edilir; bütün gün tekrar başlamaz. Tekrar deneme politikası kuyruk ve sağlayıcı katmanlarında çarpılarak kontrolsüz çağrı üretmemelidir.

Görev handler'ının dönmesi, mevzuat araştırmasının tamamlanması demek değildir. BackgroundJob durumu ile belge araştırma/rapor durumu ayrı gösterilir. İşçi kapanması, lease kaybı, tekrar teslim, broker bağlantı kaybı ve sonuç yazıldıktan sonra onay kaybı senaryoları test edilir. [RabbitMQ onay mekanizmaları](https://www.rabbitmq.com/docs/confirms) tasarım dayanağıdır.

## 10 Günlükler ve kullanıcı görünürlüğü

Her olay: runId, documentId, stage, jobId, attempt, parentJobId, correlationId, girdi/çıktı kanıt kimlikleri, sürümler, başlangıç/bitiş, süre ve sonuç içerir. Kaynak isteğinde URL, sorgu tarihi, GTİP, HTTP durumu; model çağrısında model, prompt sürümü, verilen materyaller, token/kullanım ve hata; kuyruğa ilişkin olaylarda yayın, teslim, tekrar ve tamamlanma bulunur. Kimlik bilgileri ve tokenlar günlüklere yazılmaz.

Ekran kullanıcıya şunları cevaplamalıdır: “Neden ilgili?”, “Neden Tariff/RG?”, “Hangi tarih sorgulandı?”, “Model hangi dosyaları gördü?”, “Eksik hangi sayfa/satır var?”, “Neden bekliyor?”, “Yeniden deneme neyi çalıştıracak?”, “Rapordaki bu rakam hangi kaynaktan?”.

İlerleme ayrı sayılarla gösterilir: keşfedilen, arşivlenen, okunan, ilgili, kapsam dışı, araştırılan, karşılaştırılan, raporlanan, inceleme bekleyen. Sürekli yüzdelik tahmini yerine gerçek sayaçlar kullanılır. Günlük geçmişiyle maliyet/kullanım geçmişi aynı correlationId üzerinden bağlanır.

## 11 Etkilenecek kod haritası

Aşağıdaki yollar proje köküne göredir; değişiklik önerisidir.

| Alan | Mevcut dosyalar | Yapılacak iş |
|---|---|---|
| Ana akış | `backend/src/modules/scan-runs/application/execute-scan-run.ts`, `execute-scan-command.ts` | Belge/parça işleri ve aşama bağımlılıklarını yönetmek |
| Filtre ve plan | aynı dizinde `execute-document-filter.ts`, `document-filter-prompts.ts`, `document-filter-schemas.ts`, `ports.ts` | Birleşik assessment, REVIEW, tamlık ve araştırma ihtiyaçları |
| Eski kaynak | aynı dizinde `execute-previous-source-discovery.ts`, `previous-source-prompts.ts`, `previous-source-matcher.ts` | 12.000 karakter kesmesini kaldırmak; ihtiyaç bazlı, içerikle doğrulanmış araştırma |
| Resmî erişim | `backend/src/modules/scan-runs/infrastructure/official-http-client.ts`, `resmi-gazete-search.ts`, `resmi-gazete-parser.ts` | Ortak istemci, sayfalama, kimlik ve ek kapsamı |
| Yeniden kullanılacak prototip | `backend/src/modules/gazette-prototype/{playwright-collector,official-research,research-plan,tariff-retrieval,execute-research}.ts` | Uygun parçaları üretim portlarına taşımak; yayın öncesi tarih politikasını uygulamak |
| Tariff | `backend/src/modules/tariff/tariff-lookup.ts` | Tarihsel snapshot, tam ham yanıt ve tek sorgu anlamı |
| Kanıt ve analiz | `backend/src/modules/topic-analysis/application/{enrich-with-tariff,build-evidence-bundle,execute-topic-analysis,analysis-prompts}.ts` | Tam kapsam, parça işlemleri, sürümlü analiz promptu, açık hata durumu |
| Belge içeriği | `backend/src/modules/scan-runs/application/normalize-document-content.ts` | Sayfa/madde/tablo konumlarının korunması ve parçalama sözleşmesi |
| Rapor | `backend/src/modules/topic-analysis/application/{build-report-spec,produce-report-document,render-report-html,validate-report-html}.ts`, `domain/report-spec-schemas.ts` | Eski–yeni tablo, kaynak bağları, kapsam ve sayı eşitliği |
| Kuyruk ve işçi | `backend/src/platform/{rabbitmq,queue}.ts`, `backend/src/worker.ts`, scan/topic queue adaptörleri | Aşama işleri, tekil anahtar, outbox, tekrar ve kaynak sınırları |
| Veri | `backend/prisma/schema.prisma`, scan/topic repository dosyaları | Assessment, araştırma ihtiyacı, parça kapsamı, iddia/kanıt, aşama olayları ve migration |
| Ekran | `frontend/src/features/runs/{RunDetail,RunFlow}.tsx`, `frontend/src/features/workspace/BackgroundMonitor.tsx`, ilgili API/tipler | Aşama ve materyal ayrıntısı, kapsam, sorgu ve tekrar görünürlüğü |
| Ortak kullanım | `backend/src/modules/usage/`, `backend/src/config/env.ts` | Aşama bazlı kullanım, gerçek limitlerin ayar ve ölçümü |

Yeni dosya adları sözleşmeler netleşince belirlenecek. Üretim ve prototip arasında aynı işi yapan iki aktif karar motoru bırakılmayacak. Rapor sohbeti de aynı kanıt paketini okuyacak; üçüncü bir kaynak toplama yöntemi oluşturmayacak.

## 12 Bir aylık inceleme ve uygulama sırası

Önerilen sabit değerlendirme aralığı **14 Eylül–13 Ekim 2026**, İstanbul takviminde 30 tam gündür. 14 Ekim devam eden gün olduğu için ana karşılaştırma kümesine alınmaz; mükerrer keşfi ayrı canlı senaryoyla sınanır. Yerel veritabanında bu aralıktaki yalnız 20 farklı tarih için RG içeren çalışma kaydı görüldü. Bunların içinde tamamlanmamış ve tekrar edilmiş çalışmalar var; 30 günlük tam kapsam henüz doğrulanmış değildir.

| Adım | Teslim | Tamamlanma ölçütü |
|---|---|---|
| 0 Mevcut durum ve kararlar | Bu plan, tarih politikası ve dosya haritası | Kullanıcı düzeltmeleri işlenmiş tek tasarım tabanı |
| 1 Aylık kaynak envanteri | Her günün ana/mükerrer sayıları, bütün belge başlıkları, boyut/format/ek bilgisi, erişim eksikleri | 30 tarihin her biri için keşif durumu açık; eksik gün gizlenmemiş |
| 2 Değerlendirme kümesi | Başlık ve içerik çeşitlerine göre IN/OUT/REVIEW ve araştırma rotası örnekleri | Torba kanun, büyük tablo, görsel PDF, kısa GTİP, yürürlük gecikmesi, önceki kaynaksız belge gibi durumlar gerçek belgelerle temsil edilmiş |
| 3 Veri ve prompt sözleşmeleri | Girdi/çıktı JSON şemaları, filtre+plan ve analiz promptları, örnek istekler | 11 Temmuz örneği 10 Temmuz eski veri isteği üretir; tarih ve kaynak rolleri ayrıdır |
| 4 Dar uçtan uca uygulama | Önce 2018/5 örneğinin yeni akışta taslak raporu | 7/7 GTİP okunmuş; araştırma ve karşılaştırma rapora ulaşmış; eski sürüm korunmuş |
| 5 Büyük belgeler ve RabbitMQ | Parça işleme, kapsam, tekrar, günlük ve ekran ayrıntıları | Büyük belge kesilmeden işlenir; işçi kapanmasında kaldığı yerden sürer; çift rapor yok |
| 6 Bir aylık gölge çalışma | Mevcut ve yeni sonuçların belge/satır düzeyinde karşılaştırması | Bütün belgeler hesaplanmış; kritik yanlış dışlama ve desteksiz sayı sorunları çözülmüş; REVIEW açık listelenmiş |
| 7 Kontrollü geçiş | Sürüm kontrollü etkinleştirme ve geri dönüş planı | Önceki raporlar korunur; yeni akış ölçümleri izlenir; eski aktif yol kapatılır |

Aylık envanter yalnız başlıklardan “ilgili değil” sonucu üretmek için kullanılmaz. İçerik filtresiyle karşılaştırılacak referans kararları hazırlanır; yeni model kendi kararlarını doğruluk ölçütü ilan edemez. Kalan belirsizlikler kullanıcıyla örnekler üzerinden karara bağlanır. Mevcut 16 ilgili birim testinin geçmesi bu kabul ölçütlerinin karşılandığı anlamına gelmez.

## 13 Kabul senaryoları

- 11 Temmuz yeni belge + 10 Temmuz Tariff snapshot; yürürlük ayrıca gösterilir.
- Yedi yanıtın yedisi analize girer; model bağlamına giren kimlikler ayrı doğrulanır.
- Birden fazla yürürlük, menşe ve koşul içeren tablolar yanlış eşleştirilmez.
- Tariff boş cevap, zaman aşımı ve resmî kaynakla çelişki ayrı sonuçlar üretir.
- Önceki kaynak yoksa mevcut belge raporu oluşturulur; karşılaştırma uydurulmaz.
- Önceki arama başarısızsa “yok” diye gösterilmez.
- 12.000 karakterden sonraki değişiklik maddesi araştırma ihtiyacında görünür.
- Büyük PDF'nin son sayfasındaki ilgili hüküm veya tablo satırı kaybolmaz.
- Bir belgenin bütün bölümleri OUT olmadan bütün belge OUT sayılmaz.
- Sonradan yayımlanan mükerrer ayrı keşfedilir; aynı belge yeniden raporlanmaz.
- İşçi kesilmesi ve yeniden teslim aynı belge için ikinci yayın üretmez.
- HTML karşılaştırma satırları, tarihler ve kaynaklar doğrulanmış analizle eşittir.

Bir sonraki çalışma adımı 1 ve 2'nin araştırma çıktısıdır. Bu plan kapsamında henüz 30 günlük canlı tarama, uygulama migration'ı, görev kuyruğu değişikliği veya rapor yayını yapılmamıştır.

## 14 Tariff bağlamı için netleşen tasarım

Kullanıcının son yönlendirmesine göre iki hedef birlikte uygulanacak: 120.000 byte nedeniyle sonuç atma davranışı kaldırılacak; gerekirse araştırma ihtiyacına uygun, izlenebilir veri seçimiyle model girdisi küçültülecek. Bütün sunucu ve model limitlerini sınırsız yapmak önerilmiyor. Limit aşımı veri kaybına değil ek iş/parça oluşturulmasına yol açacak.

Üç farklı veri nesnesi tanımlanacak:

1. `RawProviderResponse`: sağlayıcıdan gelen gerçek JSON; HTTP isteği, sorgu tarihi, alınma zamanı ve hash ile değişmeden saklanır. Bugünkü `TariffLookupResult` bunun eş anlamlısı değildir: `parseTariffMeasures` sağlayıcı alanlarının yalnız bir bölümünü dönüştürüyor.
2. `ResearchEvidenceView`: araştırmanın istediği önlem ve alanların görünümü. GTİP, tarih, menşe/kapsam, koşullar, istisnalar, birim, para birimi, geçerlilik, hukuki bağlantılar ve dipnotlar korunur. Her satır ham yanıta JSON konumuyla bağlıdır. İhtiyaçla ilgisiz kayıtların neden dışarıda bırakıldığı kaydedilir. Tanınmayan veya belirsiz alan sessizce atılmaz; tam ilgili kayıt modele verilir ya da inceleme işi açılır.
3. `ModelInputManifest`: hangi çağrıya hangi görünüm veya ham parça verildiği. Sadece arşivde bulunmak model tarafından okunmuş sayılmaz. `requiredEvidenceIds`, `submittedEvidenceIds`, `processedEvidenceIds` ve eksikler ayrı tutulur.

Örneğin gözetim kıymeti soruluyorsa, aynı GTİP'in ilgisiz vergi önlemlerini her model isteğine tekrar taşımak gerekmez. Ancak gözetim kaydının ülke grubu, muafiyet koşulu, brüt/net ağırlık bilgisi veya uygulama tarihi “fazlalık” sayılmaz. Kullanıcı bütün önlemleri incelemek isterse ihtiyaç kapsamı genişler, bu alanlar da analize girer. Seçim sabit “ilk N kayıt” veya modelin serbest özetiyle yapılmaz.

Örnek istek ve veri paketi, sağlayıcının gözlenen API alanlarına göre:

```json
{
  "comparisonPolicy": "PUBLICATION_PREVIOUS_DAY",
  "publicationDate": "2026-07-11",
  "previousAsOfDate": "2026-07-10",
  "currentEvidence": {"role": "CURRENT_OFFICIAL", "documentVersionId": "current-version"},
  "researchNeed": {
    "gtip": "691010000000",
    "measureKind": "SURVEILLANCE_VALUE",
    "requestedFields": ["value", "unit", "currency", "scope", "conditions", "validity", "legalBasis"]
  },
  "lookupInput": {"code": "691010000000", "date": "2026-07-10", "compare": false}
}
```

Bu bir tasarım örneğidir; 10 Temmuz isteği bu planlama turunda canlı çalıştırılmadı. Yeni değer mevcut belgeden çıkarılır; eski değer yalnız bu tarih için alınan ve kapsamı doğrulanan yanıttan yazılır. Eski değerin aynı kaldığı varsayılmaz.

## 15 Somut çalışma senaryoları

| Senaryo | Çalışacak adımlar | Görülecek sonuç |
|---|---|---|
| Günlük RG taraması | Keşif → belge/ek hazırlığı → filtre+araştırma planı → araştırma → analiz → denetim → rapor | Her belgenin IN/OUT/REVIEW kararı ve rapor durumu |
| 11 Temmuz belgesindeki 7 GTİP | Mevcut tabloyu oku → 10 Temmuz için 7 tarihsel sorgu → gözetim kayıtlarını kapsamlarıyla eşleştir → karşılaştır | 7/7 kod için sonuç veya açık eksik durumu; eski ve yeni kaynaklar ayrı |
| Tek GTİP için çok büyük Tariff cevabı | Ham yanıtı sakla → ihtiyaç görünümünü oluştur → sığarsa tek çağrı; sığmazsa bütün ilgili kayıtları parçalara dağıt | Arşiv/ilgili/modelde işlenen kayıt sayıları; kesilmiş liste yok |
| GTİP içermeyen yönetmelik değişikliği | Değiştirilen maddeyi çıkar → RG filtre araması ve aday içerik okuması → eski hükümle analiz | Tariff çağrısı yok; eski metin ve yeni metin kaynaklı |
| Önceki belge bulunamadı | Araştırmanın tamamlandığını kaydet → mevcut belgeyle analiz | “Önceki değer doğrulanamadı”; yeni düzenleme raporu var, uydurma kıyas yok |
| Sohbette “bu PDF'yi filtrelemeden analiz et ve raporla” | Seçili sürümü hazırla → gerekirse OCR → araştırma ihtiyacını çıkar → gerekiyorsa araştır → analiz → rapor | Filtre `SKIPPED_USER_SELECTED`; belge ilgili mi diye yeniden eleme yapılmaz |
| Sohbette “yalnız bu belgeye dayan, araştırma yapma” | Hazırlık → mevcut belgeyle analiz → rapor | Araştırma `SKIPPED_BY_REQUEST`; karşılaştırma yalnız belgede açıkça varsa ve kapsamı uygunsa |
| Sohbette “yalnız metnini çıkar” | Hazırlık/OCR → metin ve sayfa kapsamı | Analiz veya rapor başlatılmaz |
| Sohbette “bu analizden rapor oluştur” | Seçili analiz sürümü ve kanıt uygunluğunu kontrol et → render/denetim | Yeniden OCR, filtre veya Tariff çağrısı yapılmaz |
| Sohbette “eski değerleri araştır, rapora henüz geçme” | Hazırlık → ihtiyaç planı → araştırma | Kaynaklar, tarihli sonuçlar ve araştırma durumu; analiz/rapor yok |
| 100 sayfalık karma PDF, 8 sayfası tarama | 100 sayfayı envantere al → 92 sayfanın metnini al → 8 sayfayı görsel oku → tamlık kontrolü | 100/100 hazır olmadan eksiksiz belge etiketi yok |
| İşçi 7 sorgunun 5'inden sonra kapanır | Tamamlanmış sonuçları yeniden kullan → kalan 2 işi çalıştır → birleştir | Tek analiz/rapor sürümü; önceki 5 sorgu gereksiz tekrarlanmaz |

“Filtreyi atla” ile “araştırmayı atla” iki ayrı tercihtir. Filtre gümrük kapsamına girip girmediğini belirler. Araştırma planı ise kullanıcının zaten seçtiği belgedeki değişikliği anlamak için eksik bilgiyi belirler. Kullanıcı ayrıca istemedikçe birini atlamak diğerini otomatik atlatmaz. OCR, kimlik ve kaynak tamlığı gibi gerekli önkoşullar giriş aşamasından bağımsızdır.

## 16 OCR ve görsel okuma

Mevcut `documents/application/extract-document.ts`, metinli PDF'yi PDF.js ile okuyor. `isReadablePdfText` başarısız olan sayfa döngüde atlanıyor. Birkaç sayfa okunabildiyse `bounded` toplam metni READY yapabiliyor; bu nedenle karma PDF'nin eksik sayfaları görsel okumayı tetiklemeyebilir. Hiç metin yoksa OCR_REQUIRED oluşuyor ve model bağımlılığı verildiğinde `extractVisualDocument` devreye girebiliyor. Bu işlevdeki modelin `complete=true` beyanı tek başına sayfa/satır tamlığı kanıtı değildir.

Önerilen süreç:

1. Dosyanın sayfa sayısını ve her sayfanın metin/görsel durumunu çıkar.
2. Her sayfa için `NATIVE_TEXT`, `VISUAL_REQUIRED`, `READY`, `REVIEW` durumunu tut. Boş olduğu doğrulanan sayfa da envanterde kalsın.
3. Görsel gereken sayfayı render et; metin aktarımı ve tablo çıkarımı yap. Gemini görsel okuma mevcut sağlayıcı olarak kullanılabilir; ayrı OCR sağlayıcısı aynı port üzerinden sonradan eklenebilir.
4. Çıktıda sayfa, tablo, satır/hücre ve varsa koordinat bilgisi korunsun. Yorum veya hukuki analiz bu adımda yapılmasın.
5. GTİP, tarih ve tutar gibi kritik hücreleri kaynak görüntüyle ikinci kontrol et; belirsiz rakam için değer tahmini yapma.
6. Parça sonuçlarını kaynak sırasıyla birleştir. Sayfa sayısı, beklenen tablo devamları ve okunamayan hücreler denetlensin.
7. Yeniden deneme yalnız belirsiz sayfa/bölgeyi işlesin. Metin hazır olduğunda sonraki aşama kuyruğa girsin.

Metin katmanı bulunması tablonun doğru çıkarıldığı anlamına gelmez. Örneğin iki sütunun birbirine karışması, görünmez hatalı OCR katmanı veya kayıp dipnot görsel okumayı gerektirebilir. Bu nedenle sayfa metni uzunluğu tek kalite ölçütü olmamalıdır. Eşikler aylık gerçek belge örnekleriyle ayarlanmalı; sağlayıcının kendine verdiği güven puanı tek başına yeterli sayılmamalıdır.

## 17 Sohbet ve otomasyon için ortak mimari

Hedef yeni bir sohbet motoru veya üçüncü raporlama yolu değil, mevcut operasyon altyapısını ortak uygulama servisleriyle birleştirmektir. Sohbet, zamanlayıcı ve ekran yalnız farklı giriş adaptörleridir.

```text
Sohbet / Zamanlayıcı / İşlem ekranı
                 ↓
        WorkflowRequest ve Planner
                 ↓
   Hazırlık → Değerlendirme/Plan → Araştırma
                 ↓
          Analiz → Denetim → Rapor
                 ↓
  Repository portları + sağlayıcı portları
                 ↓
PostgreSQL / Nesne deposu / RabbitMQ / Gemini / RG / Tariff
```

Önerilen katmanlar:

- Domain: tarih politikası, kaynak rolleri, kapsam, durum geçişleri ve karşılaştırma kuralları. Prisma, Fastify, Gemini veya RabbitMQ import etmez.
- Application: hazırlık, değerlendirme, araştırma, analiz ve rapor kullanım senaryoları. Dış servisleri portlar üzerinden çağırır.
- Infrastructure: Prisma repository, nesne deposu, Tariff HTTP, RG HTTP/Playwright, Gemini ve kuyruk adaptörleri.
- Entrypoints: sohbet araçları, API, worker ve zamanlayıcı. Aynı kullanım senaryolarına yetkili istek gönderir.

Önerilen istek sözleşmesi `entryStage`, `targetStage`, `documentVersionIds`, `analysisRevisionId`, `filterPolicy`, `researchPolicy`, `comparisonPolicy`, `templateRevision`, `actorScope`, `idempotencyKey` alanlarını taşır. Model veya sohbet metni doğrudan veritabanı yazısı ya da serbest iş türü üretemez; şema ve yetki doğrulamasından geçer.

Örnek: `entryStage=ANALYZE`, `targetStage=REPORT`, `filterPolicy=SKIP_USER_SELECTED`, `researchPolicy=AUTO_IF_NEEDED`. Planner seçili belgenin OCR'ı eksikse hazırlığı ekler, filtreyi eklemez; gerekli araştırma planını oluşturur. Var olan analizden rapor istenirse giriş ANALYSIS_REVISION olur ve yalnız rapor önkoşulları değerlendirilir.

## 18 Bugünkü sohbet yollarında görülen ayrışmalar

- `send-chat-message.ts` rapor isteğini `gatherReportEvidence` ve `PrismaChatReportCreator` yoluna, belge analizi isteğini `parseDocumentOperation` üzerinden operasyon servisine yönlendiriyor.
- `create-chat-report.ts` metinleri topluyor; doğrudan URL yolunda bağlı eklerin ayrıca taranmadığını uyarı olarak yazıyor. Toplam 250.000 karakter sınırı var.
- `PrismaChatReportCreator` kendi ANALYZE → BUILD_REPORT → PUBLISH_REPORT görevlerini ve outbox kayıtlarını kuruyor. Ortak planner yerine ayrıca görev planlıyor.
- `operations/executors.ts` seçili sürümler için varsayılan 250.000 byte sınırı kullanıyor. Sohbet kaynak snapshot yolunda `analyzeWithTariff`, seçili belge sürümleri yolunda doğrudan `analyzeSourceEvidence` çağrılıyor; Tariff davranışı eşit değil.
- `report-tariff-evidence.ts` önce analizdeki tek ve kaynakta açık yürürlük tarihini arıyor, en fazla 10 GTİP kabul ediyor, yürürlük öncesi ve sonrası sorgu yapıyor. Kullanıcının yayın öncesi gün politikasına uymuyor.
- `report-analysis-service.ts` yeniden analiz için ayrıca doğrudan model çağrısı yapıyor. Bunun da ortak iş planı ve sürümleme yoluna alınması gerekiyor.

Bu tespitler mevcut dosyaların incelenmesine dayanır; bütün giriş yollarının uçtan uca canlı çalıştırıldığı iddiası değildir. Uygulama öncesi bu dalların davranış testleriyle sabitlenmesi gerekir.

## 19 İncelemek için dosya okuma sırası ve değişiklik yerleri

| Sıra | Proje kökünden dosya | Şu anki görevi | Planlanan müdahale |
|---|---|---|---|
| 1 | `backend/src/modules/scan-runs/application/execute-scan-run.ts` | Günlük taramanın ana aşama sırası | Ortak planner'a giriş adaptörüne dönüştürme |
| 2 | `backend/src/modules/scan-runs/application/execute-document-filter.ts` | Başlık/içerik kararları | Ortak assessment, parça kapsamı ve araştırma planı |
| 3 | `backend/src/modules/scan-runs/application/execute-previous-source-discovery.ts` | Eski kaynak işi | Ortak araştırma servisini çağırma |
| 4 | `backend/src/modules/topic-analysis/application/enrich-with-tariff.ts` | Kod bulma, Tariff ve model bağlamı | 120 KB sessiz elemesini kaldırma; araştırma paketini tüketme |
| 5 | `backend/src/modules/tariff/tariff-lookup.ts` | Tariff sorgusu ve dönüştürme | Ham yanıt + tarihsel snapshot + kapsamlı alan eşleme |
| 6 | `backend/src/modules/documents/application/extract-document.ts` | PDF/Office/metin ve görsel okuma | Sayfa bazlı kapsam, OCR işleri ve kalite kontrolü |
| 7 | `backend/src/modules/chat/application/send-chat-message.ts` | Sohbet isteği yönlendirme | Aynı workflow isteğini oluşturma |
| 8 | `backend/src/modules/chat/application/chat-operations.ts` | Metinden işlem isteği çıkarma | Aşama ve politika seçeneklerinin açık sözleşmesi |
| 9 | `backend/src/modules/chat/application/create-chat-report.ts` | Sohbet kanıtlarını toplama | Metin kopyası yerine sürümlü kanıt referansları; ortak hazırlık |
| 10 | `backend/src/modules/chat/infrastructure/prisma-chat-report-creator.ts` | Sohbete özel görev zinciri | Görev üretimini ortak planner'a devretme |
| 11 | `backend/src/modules/operations/operation-service.ts` | Plan, görev, tekrar kullanım ve yetki | Ortak giriş aşamaları, önkoşullar ve politika sürümleri |
| 12 | `backend/src/modules/operations/executors.ts` | İşlem türlerine göre analiz/rapor | İş mantığını ortak uygulama servislerine devretme; ince adaptörler |
| 13 | `backend/src/modules/operations/report-tariff-evidence.ts` | Sohbet snapshot analizine Tariff ekleme | Ayrı tarih/GTİP kurallarını kaldırıp ortak araştırma kullanma |
| 14 | `backend/src/modules/operations/report-analysis-service.ts` | Raporun analizini yeniden çalıştırma | Aynı kuyruk ve analiz sürümü yolu |
| 15 | `backend/src/modules/operations/operation-dispatcher.ts` | Çalışabilir görevleri RabbitMQ'ya iletme | Yeni parça bağımlılıkları, yeniden başlatma ve iptal uyumu |
| 16 | `backend/src/worker.ts`, `backend/src/platform/rabbitmq.ts` | Adaptörleri bağlama ve mesaj teslimi | Ortak kullanım senaryolarını çalıştırma; iş mantığı taşımama |
| 17 | `backend/src/modules/topic-analysis/application/execute-topic-analysis.ts` | RG kanıtından analiz | Ortak AnalysisPackage ve analiz servisi |
| 18 | `backend/src/modules/topic-analysis/application/build-report-spec.ts` | Analizi rapor kartına çevirme | Karşılaştırma ve eksik kaynak durumlarının kayıpsız aktarımı |
| 19 | `backend/prisma/schema.prisma` | Kalıcı kayıtların ilişkileri | Sayfa/parça kapsamı, araştırma ihtiyacı, ham yanıt ve model girdisi izleri |

Yeni ortak modül için önerilen yer `backend/src/modules/legislation-workflow/`: `domain/contracts.ts`, `domain/comparison-policy.ts`, `application/plan-workflow.ts`, `prepare-evidence.ts`, `assess-document.ts`, `research-previous.ts`, `analyze-evidence.ts`, `application/ports.ts`, `infrastructure/prisma-workflow-repository.ts`. Bunlar henüz oluşturulmadı. Mevcut dosyalar bir defada silinmez; aşamalı adaptasyon ve aynı örnekler üzerinde davranış eşitliği sağlandıktan sonra yinelenen kod kaldırılır.

## 20 Veritabanı ve ilerleme kayıtları

Mevcut `Document`, `DocumentVersion`, `OperationRequest`, `OperationTask`, `OperationArtifact`, `OperationOutbox`, `AnalysisRevision` ve `ReportRevision` yapıları değerlendirilerek yeniden kullanılacak. Bütün şema baştan atılmayacak. `CollectedDocument` ile genel belge sürümü arasında kaynak kimliği ve sürüm ilişkisi kurulacak; geçmiş raporların bağlantıları bozulmayacak.

Yeni veya genişletilecek mantıksal kayıtlar: EvidencePart (sayfa/ek/kapsam), ExtractionAttempt (yöntem/sonuç), ResearchNeed, ResearchAttempt, ProviderSnapshot, EvidenceSelection, ModelInputManifest, ClaimEvidence ve WorkflowEvent. Hangi kayıtların bağımsız tablo olacağı ve hangilerinin sürümlü artifact olacağı indeksleme, sorgulama ve saklama ihtiyacına göre şema adımında kesinleştirilecek.

Büyük JSON/PDF nesne deposunda tutulur; PostgreSQL kimliği, hash'i, ilişkiyi ve durumları tutar. Model girdileri bu referanslardan hazırlanır. Kanıt hash'i, prompt, karşılaştırma politikası veya OCR sürümü değişirse ilgili sonraki işler geçersizleşir; sadece aynı şartlarda tekrar kullanım yapılır. Kullanıcının özel belgesi başka kullanıcının sohbetine veya önbellek sonucuna sızmamalıdır; erişim kapsamı hem sorgu hem tekrar kullanım anahtarında korunur.

Sohbet bağlantısı kapansa bile kabul edilmiş kalıcı iş sürer; kullanıcı açıkça iptal ederse ilgili iş ağacı iptal edilir. Sohbet ve işlem ekranı aynı task/event kayıtlarını gösterir. Modelin söylediği “tamamlandı” metni veritabanındaki iş sonucu yerine geçmez.

Ek kabul testleri: aynı belge ve aynı politikalarla sohbet/otomasyon eşdeğer analiz paketi üretmeli; filtre atlama araştırmayı kendiliğinden kapatmamalı; yalnız OCR isteği analiz başlatmamalı; karma PDF'de atlanan sayfa READY olmamalı; snapshot ve seçili sürüm analizleri aynı Tariff tarihini kullanmalı; model girdisi seçiminde koşul/dipnot kaybolmamalı.
