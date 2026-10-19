# ATEZ Mevzuat Web App

## Dev dalının çalışma tabanı — 20 Ekim 2026

Bu dal, Antigravity klasöründe `localhost:5173` üzerinde kullanılan sürümü esas alır. Arayüz aynı adreste, ana API `3001` üzerinde çalışır. Şablon stüdyosu artık API/rapor worker’ı içine gömülüdür; ayrı `3101` servisi gerekmez. Mevcut ana ve stüdyo veritabanları ayrı tutulur ve verileri korunur. V2’nin yeni tarama/analiz motorunun devreye alınması sonraki aşamadır.

Mevcut kurulumu güncellerken `v2/` içinde `pnpm install --frozen-lockfile`, `frontend/` içinde `npm run build`, ardından proje kökünde `./deploy/install-local-services.sh` çalıştırılır. Bu geçiş için migration veya veritabanı sıfırlama gerekmez. Yeni makine kurulumu mevcut `.env`, yerel kimlik yapılandırması ve veritabanı yedeklerini ayrıca gerektirir; bunlar GitHub’a taşınmaz. Ayrıntılar: [şablon stüdyosu işletim notları](docs/operations/template-studio.md).

Bu sürüm, manuel olarak seçilen bir tarih için Resmî Gazete ana ve mükerrer sayılarını; ilanlar dahil tüm belgeleri ve belge içindeki desteklenen dosyaları toplar. Başlık ve gerektiğinde içerik tabanlı Gemini filtresinden geçen her ilgili belge bağımsız analiz edilir, önceki resmî kaynağıyla ilişkilendirilir ve tek kartlı ATEZ HTML bültenine dönüştürülür. İlgili değişiklik yoksa Gemini çağrısı yapılmadan `00-degisiklik-yok.html` üretilir.

## Dış kaynaklardan AI raporları

Kaynak taramaları özgün HTML/PDF'yi ve içerikteki doğrudan dosya/görsel bağlantılarını nesne deposuna kaydeder. Tarama ayrıntısında dosyalar indirilebilir; PDF ve desteklenen görseller analiz kanıtlarına bağlanır. Genel HTML kaynakları, tarihli `article`, `li` veya tablo satırlarından okunur; etkinleştirilen HTML uç noktalarına `GENERIC` adaptörü atanır. Tarihsiz, oturum gerektiren veya yalnızca JavaScript ile yüklenen siteler için özel adaptör gerekebilir.

Bu bir sitenin tamamını indiren tarayıcı değildir: sayfalama ve bağlı HTML sayfalarının tamamı özyinelemeli gezilmez. Bir belgede en fazla 40 doğrudan ek, dosyada 25 MB, kaynak taramasında 100 MB sınırı vardır. PDF metni okunur; taranmış PDF'ler OCR yapılmadan arşivlenir. Office/arşiv dosyaları özgün olarak saklanır, içerikleri açılmaz. Dosya bağlantıları aynı kaynak alan adı/alt alanları ve desteklenen resmî alanlarla sınırlıdır. Eksik ek veya kapsam sınırı açık hata üretir; eksik kanıtla rapor yayımlanmaz. Eski tarama kayıtları yeniden çalıştırılmadan dosya arşivi kazanmaz.


Ticaret Bakanlığı, İGMD, Mevzuat.Net ve TARIFF belgeleri önce gümrük/dış ticaret AI filtresinden geçer. İlgili bulunan belgeler mevcut analiz, kanıt arşivi, rapor sürümü ve sohbet hattını kullanır. Hazır raporlar Raporlar listesinden veya kaynak tarama ayrıntısından açılır; aynı çalışma alanında revize edilir, PDF indirilir ve dağıtılır. Ticari/mesleki kaynaklar destekleyici kaynak olarak gösterilir.

Kaynak ayrıntısında bulunan, ilgili, kapsam dışı, başarısız ve hazır rapor sayıları ayrıdır. Eski alıntı özetleri doğrulanmış rapor sayılmaz; eski taramalar için “AI değerlendirmesini başlat” kullanılabilir. AI hizmeti başarısız olduğunda rapor uydurulmaz; işlem hata durumuna geçer ve yeniden denenebilir. Tekrar denemeler mevcut raporları çoğaltmaz.

## Sohbet ve rapor çalışma alanı

Raporlar sohbet ekranındaki **Rapor düzelt** açılır panelinde seçilir; `/chat?topic=<id>` bağlantıları aynı paneli açar. Henüz yayımlanmamış rapor bağlantıları sohbeti kapatmadan bilgi mesajı gösterir. Sohbet geçmişi yalnızca kullanıcının açtığı sohbetleri listeler; rapor revizyonlarının denetim geçmişi raporda korunur. Aynı ekranda AI revizyonu, render edilmiş sayfa üzerinde görsel düzenleme, bölüm başlıkları ve sırası, sürükle-bırak ve hazır bileşenler, şablon uygulama, ek kaynaklar, sürüm geçmişi, yayımlama, PDF ve e-posta bulunur. `/reports/:id` bağlantıları bu çalışma alanına yönlendirilir. Kaynak siteleri, eklenen kaynakların metin görüntüleri, şablonlar, mail grupları ve otomasyonlar veritabanında saklanır.

Varsayılan günlük taramalar İstanbul saatine göre **05:00, 10:00, 15:00 ve 23:00** çalışır. Otomasyonlar ekranından farklı kaynaklar, şablon ve dağıtım gruplarıyla görev oluşturulabilir; birden fazla tekrar saati (ör. 08:00, 12:30, 18:00) ve haftanın günleri seçilebilir. Görevler düzenlenebilir, duraklatılabilir, silinebilir ve elle çalıştırılabilir. Dağıtım grupları raporda önerilir; e-posta kullanıcı gönderdiğinde iletilir. Makine ve Docker altyapısı çalışıyor olmalıdır.

## Uygulama genelinde AI kullanımı

`/usage` ekranında ay seçimi, dört özet kartı ve işlem bazında token/model/pay tablosu bulunur. Tarih, işlem türü, kullanıcı ve başlık filtreleri isteğe bağlı açılır. Ayrıntı panelinde her çağrının girdi, çıktı, sağlayıcı toplamı, önbellek, düşünme tokenları ve durumu gösterilir. Tarihler Türkiye saatine göre uygulanır. Kullanıcı kendi tüketimini; yönetim yetkilileri aynı çalışma alanının tüketimini görür. Özel sohbet/rapor başlıkları ve bağlantıları yetkisiz kullanıcılara açılmaz.

Genel sohbet, web/tarayıcı araştırması, revizyon, otomasyon, manuel tarama/analiz/rapor üretimi ve şablon AI çağrıları `ChatUsageEvent` tablosunda tekil çağrı başına tutulur. İşçi süreçlerinde işlem/tarama bağlamı çağrıya aktarılır; otomasyon servis çağrıları insan kullanıcıya yazılmaz. Resmî Gazete araştırma betiği de açık veritabanı bağlantısı ve servis aktörü üzerinden yeni model çağrılarını kaydeder; önbellekten kullanılan analizler yeni tüketim oluşturmaz.

Kümülatif akış ölçümleri aynı kaydı günceller; her yeniden deneme ve yeni model turu ayrı çağrıdır. Başarısız veya kesilen çağrının bildirilmiş tüketimi korunur. Merkezi olarak ölçülen revizyonlar eski `TopicAiExecution` kaydıyla tekrar toplanmaz. Sağlayıcı toplamına önbellek/düşünme tokenları yeniden eklenmez; toplam eksikse bilinen girdi/çıktı/düşünme kalemleri kısmi tüketimdir. Eski ölçülmemiş kayıtlar ana listeden çıkarılır ve tahminle doldurulmaz. Parasal maliyet hesabı yapılmaz.

Yeni ölçüm için `20261013180000_all_ai_usage` migration’ını uyguladıktan sonra API ve worker yeniden başlatılmalıdır. Yeni AI sağlayıcılarını ortak kullanım kaydedicisine bağlamak gerekir. Testler gerçek sağlayıcı çağrısı yapmadan ölçüm, tekrar, hata, yetki ve toplamları doğrular.

## Bu Mac üzerinde kalıcı çalıştırma

Docker ağ erişiminin kısıtlı olduğu bu makinede API ve görev işçisi Mac üzerinde, veritabanı/nesne deposu/PDF servisi Docker içinde çalışır. Mevcut `.env` korunur; `LOCAL_DATABASE_URL` varsa yerel bağlantı için kullanılır. Kurulumdan sonra servisler kullanıcı oturumu açıldığında yeniden başlar.

```bash
docker compose up -d db object-storage gotenberg rabbitmq
(cd frontend && npm ci && npm run build)
(cd backend && npm ci && npm run prisma:generate && npm run prisma:migrate)
./deploy/install-local-services.sh
```

Uygulama `http://127.0.0.1:5173` veya `http://localhost:8888` üzerinden açılır. Sağlık kontrolü `/api/health` adresindedir. Günlükler `~/Library/Logs/ATEZ` altında tutulur. Kod değişikliklerinden sonra ön yüz derlemesini ve kurulum betiğini yeniden çalıştırın. Aynı anda Docker backend/worker/web servislerini başlatmayın. Veritabanı silme veya sıfırlama bu kurulumun parçası değildir.

## Docker ile yerelde çalıştırma

Docker Desktop açıkken proje kökünde:

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f backend worker
```

İlk taramadan önce AI bağlantısı yapılandırılmalıdır. Vertex AI için aşağıdaki ayarları kullanın; Developer API için `GOOGLE_GENAI_USE_VERTEXAI=false` ve geçerli `GEMINI_API_KEY` gerekir. Varsayılan geliştirme modeli `gemini-3.7-flash` olup topic analizleri `TOPIC_ANALYSIS_CONCURRENCY` sınırıyla birbirinden bağımsız çalışır.

İlk açılışta backend veritabanı migration'larını otomatik uygular. Gerekirse elle tekrar çalıştırılabilir:

```bash
docker compose exec backend npm run prisma:migrate
```

Uygulama `http://localhost:8888`, API sağlık bilgisi `http://localhost:8888/api/health`, MinIO yönetim ekranı ise `http://localhost:9001` adresindedir. Yerel MinIO kullanıcı bilgileri `.env.example` içindeki geliştirme değerleridir.

Yerel nesne deposundaki `resmi-gazete` bucket'ı backend ve worker tarafından idempotent biçimde oluşturulur. Aynı dosyanın tekrar indirilmesi yeni bir byte kopyası üretmez; SHA-256 anahtarıyla mevcut nesne kullanılır.

Her topic için kanıt manifesti, değişmez `analysis.json`, kapsamlı `analysis.md`, `report-spec.json` ve doğrulanmış HTML revizyonları MinIO'da run klasörü altında saklanır. Rapor ekranındaki konuşma yalnızca o mevzuat değişikliğine aittir; yayın görünümü talepleri yeni rapor revizyonu, analizi etkileyen talepler ise yeni analiz ve rapor revizyonu oluşturur. API anahtarı, model istemleri veya güven puanları kullanıcı arayüzüne gönderilmez.

Resmî Gazete sunucusu ara sertifikasını TLS el sıkışmasında göndermediği için image içinde DigiCert tarafından yayımlanan `GeoTrust TLS RSA CA G1` ara sertifikası bulunur ve Node'a ek güven zinciri olarak tanıtılır. TLS doğrulaması kapatılmaz.

## Üretim

Sabit digest ile tanımlanan MinIO servisi yalnızca yerel geliştirme içindir. `docker-compose.prod.yml` yerel nesne deposu veya erişim anahtarı içermez. Üretimde `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` ve `S3_SECRET_ACCESS_KEY` değerleri deployment secret store üzerinden verilmeli; standart S3 servisleri için `S3_FORCE_PATH_STYLE=false` kullanılmalıdır.

Üretim yapılandırmasını doğrulama örneği:

```bash
docker compose -f docker-compose.prod.yml config
```

## Cron işleri ve RabbitMQ

Otomasyonlar ekranındaki **Arka plan işleri · RabbitMQ** paneli 10 saniyede bir bekleyen mesajları, tüketici sayılarını, yeniden denenecek ve başarısız işleri gösterir. `/api/v1/background-jobs` aynı durumu sağlar; `/api/health` RabbitMQ bağlantısını ve her kuyruğun tüketicisini kontrol eder. Kaynak hataları ayrıca tarama ayrıntısında görünür.

PostgreSQL/pg-boss kalıcı cron saati olarak korunur. Cron tetiklemeleri RabbitMQ'ya yayın onayı alındıktan sonra aktarılmış sayılır. Tarama ve analiz outbox kayıtları doğrudan RabbitMQ'ya gönderilir; bağımsız kaynak taramaları ve periyodik kaynak yenilemeleri de RabbitMQ tüketicileri üzerinden çalışır. İlk analiz/rapor üretimi tarama işinin aşamalarıdır. Sohbet, kullanıcının beklediği PDF ve onaylı e-posta gönderimi mevcut istek akışında çalışır.

Mesajlar kalıcıdır; tüketici işi bitirince teslim onayı verir. İş kimlikleri ve 30 saniyelik kalp atışıyla yenilenen 90 saniyelik kilitler PostgreSQL'de tutulur. Aynı mesajın tekrar yayınlanması tamamlanan işi yeniden çalıştırmaz. İş hataları 30 saniye sonra en fazla iki kez tekrar denenir; son hata `.failed` kuyruğunda ve iş tablosunda saklanır. Bağlantısı kesilen worker servis yöneticisi tarafından yeniden başlatılır. Silinmiş, duraklatılmış veya düzenlenmiş otomasyonların eski cron mesajları atlanır; başlamış taramalar devam eder. Zamanlama değişiklikleri en geç 30 saniye içinde cron saatine yansır.

Yerel RabbitMQ yönetim paneli `http://127.0.0.1:15672` adresindedir. Yerel API/worker için `LOCAL_RABBITMQ_URL`, doğrudan çalıştırmalar için `RABBITMQ_URL`, Docker için `RABBITMQ_DOCKER_URL` kullanılabilir. Compose kullanıcı/parola için `RABBITMQ_USER` ve `RABBITMQ_PASSWORD` kullanır; üretimde bunları secret store üzerinden sağlayın. Değişiklik sonrası Prisma migration'ını uygulayın ve backend/worker süreçlerini birlikte yeniden başlatın; eski worker'ları yeni worker'larla eşzamanlı çalıştırmayın. Yükseltmede eski pg-boss tarama/analiz mesajları da RabbitMQ'ya aktarılır.

RabbitMQ entegrasyon testi yalnızca `RABBITMQ_TEST_URL` verilirse çalışır. Bunu izole bir vhost'a, `DATABASE_URL` değerini ise ayrı test veritabanına yönlendirin; mevcut entegrasyon testleri test verilerini siler.

İş akışı testleri gerçek PostgreSQL, RabbitMQ ve MinIO ile ayrı test ortamında çalışır. `job-workflow.test.ts` gerçek cron saatinin tetiklemesini, manuel otomasyon ve bağımsız kaynak işlerinin rapor üretmesini kontrol eder; Resmî Gazete kabul testi manuel/cron işlerini RabbitMQ üzerinden worker işleyicisine gönderir. Dış kaynak içerikleri ve AI yanıtları test verisidir. Kuyruk testi gerçek 30 saniyelik gecikmeyle yeniden denemeleri, eksik hedef kuyruğunun yayını reddetmesini ve kapanışta aktif teslimin tamamlanmasını doğrular. Eşzamanlı aynı istek tek iş/outbox oluşturur; kaynak seçimi iş/outbox ile aynı işlemde yazılır. Arayüz, bağlantı hatası sonrası tekrar denemede aynı istek anahtarını korur.

Sohbetin günlük/son rapor listesi ve tarama durumu sorguları doğrudan kayıtlı verilerden yanıtlanır; model servisi kullanılamasa da bu sorgular çalışır. Genel AI yanıtları, analiz ve revizyon için erişimi açık bir Gemini projesi gerekir. `PERMISSION_DENIED` / “Your project has been denied access” yanıtı Google projesinin erişim engelidir; uygulama bu yetkiyi kendiliğinden açamaz. Sağlayıcı hataları kullanıcıya güvenli Türkçe mesajlarla gösterilir.

## Dağıtım grupları ve dosya aktarımı

`/groups` sayfası grup/alıcı araması, durum filtresi, kişi adı düzenleme ve seçili grupları dışa aktarmayı destekler. XLSX, UTF-8 CSV ve TSV dosyaları veya Excel’den yapıştırılan tablolar; çalışma sayfası ve sütun eşleştirme adımlarından sonra önizlenir. Eski XLS dosyaları önce XLSX olarak kaydedilmelidir.

Dosya limiti 5 MB, tablo limiti 10.000 veri satırı/100 sütun, tek aktarım limiti 50 grup ve grup başına toplam 200 alıcıdır. Tekrarlar grup içinde ayıklanır; aynı kişi farklı gruplarda bulunabilir. Hatalı satırlar önizlemede gösterilir ve indirilebilir. Aktarım mevcut alıcıları korur; çoklu grup kaydı tek veritabanı işlemiyle uygulanır. Grup düzenleyicisindeki toplu ekleme önce taslağa ekler, `Grubu kaydet` ile kalıcılaşır.

CSV/XLSX şablon ve dışa aktarma sütunları `Grup`, `Ad Soyad`, `E-posta` şeklindedir. Excel formül hücreleri içe alınmaz; önce değer olarak yapıştırılmalıdır. Dosya işlemleri `config.manage` yetkisi gerektirir. `20261013170000_group_recipient_names` migration’ı kişi adlarını ekler; mevcut `emails` dizisi ve gönderim/otomasyon bağlantıları korunur.

## Vertex AI bağlantısı

API ve worker ortak `createGoogleAi` bağlantısını kullanır. Yerel `.env` ayarları:

```dotenv
GOOGLE_GENAI_USE_VERTEXAI=true
GOOGLE_CLOUD_PROJECT=your-company-project
GOOGLE_CLOUD_LOCATION=global
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
GEMINI_MODEL=gemini-3.8-flash
GEMINI_BROWSER_MODEL=gemini-3.8-flash
```

Bölge şirketin veri politikası ve model desteğine göre seçilmelidir. Yerel servis çalıştırıcısı kök `.env` dosyasını okur; ayar değişince API/worker yeniden başlatılır. Google Cloud üzerinde bağlı servis hesabı veya yerel ADC kullanılıyorsa `GOOGLE_APPLICATION_CREDENTIALS` gerekmez. Vertex seçiliyken eksik proje/bölge hatadır; eski API anahtarına otomatik dönüş yapılmaz.

JSON anahtarı Git'e veya Docker imajına eklemeyin. Docker ile JSON kullanırken:

```bash
docker compose -f docker-compose.yml -f docker-compose.vertex.yml up --build -d
# Üretimde ilk dosya yerine docker-compose.prod.yml kullanın.
```

Override, host üzerindeki `GOOGLE_APPLICATION_CREDENTIALS` dosyasını API ve worker'a salt okunur secret olarak bağlar. Google Cloud bağlı kimlik kullanımında bu override gerekmez.

Yeni uygulama çağrıları `provider=vertex` ile mevcut kullanım tablosuna kaydedilir. Girdi, çıktı, toplam, önbellek ve düşünme tokenları sağlayıcının bildirdiği değerlerdir; akış ara toplamları tekrar eklenmez. Eksik tüketim sıfır kabul edilmez. Token ekranı parasal fatura hesabı değildir; arama gibi ek hizmet ücretleri Cloud Billing'den izlenmelidir. Eski kayıtlar değiştirilmez.

## Sohbet kaynak kapsamı

Google Search ve genel tarayıcı ajanı şu anda kapalıdır. Sohbet menüsünde bu seçenekler sunulmaz; eski istemcilerden gelen `webSearch=true` veya `browserAgent=true` istekleri API'de reddedilir. Sohbet uygulama katmanı da model veya tarayıcı çağrısı yapmadan bu istekleri engeller.

Seçili tanımlı kaynaklardan içerik toplama, arşiv belgeleri, kayıtlı rapor/analizler, otomasyon ve işlem kayıtları kullanılabilir. Kanıt bulunmadığında asistanın eksikliği belirtmesi istenir. Kaynak toplama otomasyonları ve yetkili Tariff bağlantısı devam eder; genel internette model tabanlı araştırma açılmaz.

V2 backend geçişi, veri koruma, test sonuçları ve geri dönüş: [işletim notları](docs/operations/v2-backend-integration.md).
