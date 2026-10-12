# RabbitMQ izleme ve iş kurtarma uygulama planı

12 Ekim 2026 saat 10.41 İstanbul kontrolünde RabbitMQ ve worker aktiftir. Yedi uygulama kuyruğunda birer tüketici vardır; bekleyen, onay bekleyen ve tekrar kuyruğunda mesaj yoktur. Başarısız tarama kuyruğunda iki eski mesaj bulunur. Temel mesaj akışı çalışmaktadır; izleme ekranındaki anlam karışıklığı ve kurtarma kontrolleri iyileştirilmelidir. Bu çalışma inceleme ve plan kapsamındadır; uygulama kodu veya mevcut iş kayıtları değiştirilmemiştir.

## Doğrulanan çalışma durumu

Broker `resmi-gazete-manual-ingestion-rabbitmq-1` sağlıklıdır; ping başarılıdır ve yerel kaynak alarmı yoktur. İki AMQP bağlantısı running durumundadır. Worker bağlantısında yedi tüketici kanalı vardır. Her kanalın prefetch değeri 1 ve onay bekleyen mesaj sayısı 0'dır. Etkin consumer_timeout 18.000.000 ms, yani beş saattir.

Veritabanında 81 tamamlanmış BackgroundJob ve iki başarısız kayıt bulunur. Tarama ve konu outbox tablolarında gönderilmemiş kayıt yoktur. Saat 10.37'de konu analizi/revizyon komutları, 10.20'de tarama komutu tamamlanmıştır. Bu kayıtlar taşıma ve komut işleyicisinin tamamlanmasını gösterir; ilgili işin her zaman yeni belge ya da başarılı rapor ürettiğini göstermez. İş sonucu ayrıca ScanRun, TopicProcess veya OperationTask üzerinden okunmalıdır.

| Eski iş | Son kayıt zamanı | İşlem adımı | Sonuç |
|---|---|---|---|
| Kaynak erişim hatası | 7 Ekim 2026 10.59 İstanbul | DISCOVERING | fetch failed, 3 iş denemesi, tarama FAILED |
| AI filtreleme hatası | 8 Ekim 2026 01.42 İstanbul | AI_FILTERING | UnknownError, 4 iş denemesi, tarama PARTIAL |

İkinci hata UTC'de 7 Ekim 22.42'dir; İstanbul takviminde 8 Ekim'e karşılık gelir. Saklanan hata metni alttaki sağlayıcı nedenini açıklamaz. Bu kayıttan Gemini izin sorunu olduğu kesinleştirilemez.

Broker loglarında 09.19, 09.19.33 ve 09.50 civarında istemcinin TCP bağlantısını kapattığı ve hemen yeniden bağlandığı görülür. Worker hata dosyasında geçmiş Workspace migration hataları ve üç genel RabbitMQ connection error satırı vardır. Bu dosyada olay zamanları yazmadığından her hatayı belirli bir broker kapanışına bağlamak mümkün değildir. launchctl worker'ı yeniden başlatmaktadır; şu an çalışır, önceki çıkış kodu 1'dir. Mevcut durum sürekli kesinti göstermese de geçmiş kapanış nedenlerini güvenilir biçimde izlemek gerekir.

## Mevcut mesaj akışı

1. API, iş kaydını ve outbox komutunu veritabanına yazar. Zamanlı işler pg-boss tarafından tetiklenir ve RabbitMQ'ya iletilir.
2. Relay, RabbitMQ'ya kalıcı mesaj gönderir ve publisher confirm aldıktan sonra outbox gönderildi bilgisini günceller.
3. Worker mesajı alır. BackgroundJob kaydında atomik bir iş kilidi alır; 90 saniyelik kilidi 30 saniyede bir yeniler.
4. İşleyici kayıtlı başlatan kullanıcının güncel yetkisiyle çalışır. İş tamamlandığında veritabanı sonucu kaydedilir ve mesaj ack ile onaylanır.
5. Hatalı mesaj 30 saniyelik retry kuyruğuna gider. Normal akış en fazla üç çalıştırma denemesinden sonra failed kuyruğuna taşır. Yeniden teslim ve kilit kurtarma senaryolarında deneme sayısı ayrıca değerlendirilmelidir; mevcut eski kayıtta dört deneme vardır.

Kalıcı mesajlar, publisher confirms ve manuel ack doğru temel tercihlerdir. RabbitMQ, bağlantı kaybında onaylanmamış mesajı yeniden teslim edebilir; uygulama tekrar teslim edilen işin yan etkilerini idempotent tutmalıdır. [RabbitMQ onaylama rehberi](https://www.rabbitmq.com/docs/confirms)

## Bulunan sorunlar

**P1 İzleme ekranı tüketiciyi çalışan iş olarak gösteriyor.** `frontend/src/features/workspace/AutomationPages.tsx` tablosundaki Çalışan alanı doğrudan `consumers` kullanır. Ekrandaki her satırda 1 bulunması yedi iş yürütüldüğü anlamına gelmez. Üstteki Çalışıyor kartı ise son 50 tamamlanmamış veritabanı kaydını sayar; süresi geçmiş kilitleri de sayabilir ve 50 kayıttan sonra eksik toplam verir.

**P1 Taşıma durumu ile iş sonucu ayrılmıyor.** BackgroundJob COMPLETED, işleyicinin geri döndüğünü anlatır. ScanRun PARTIAL veya AWAITING_RETRY durumunda olabilir. Zamanlama komutu yalnız tarama oluşturmuşken tamamlanır. İş ekranı bunları bağlamalıdır.

**P1 Worker kontrollü kapanışı bağlı değil.** RabbitQueue.close tüketicileri iptal edip mevcut işleri bekleyebilir; worker.ts SIGTERM/SIGINT yolunda bunu çağırmaz. Yerel wrapper yalnız sinyali çocuğa iletir. Yeniden teslim için temel mekanizma vardır, fakat planlı yeniden başlatmalarda gereksiz kesinti ve yeniden çalıştırma riski devam eder.

**P1 Hata kaydı yetersiz.** Connection/channel hata dinleyicileri gerçek neden yerine genel bir mesaj yazıyor. BackgroundJob yalnız son hata mesajını tutuyor; tarih, çalışma bağlantısı, neden zinciri ve deneme geçmişi UI'da yok. İki eski hata sürekli güncel uyarı gibi duruyor.

**P2 Kopma ve çökme sınırları için kabul testi gerekiyor.** Publisher confirm sonrası DB güncellemesi, retry/failed mesajının confirm edilmesi sonrası durum güncellemesi ve ack öncesi çökme ayrı işlemlerdir. Mevcut DB kilidi tekrarları sınırlar; bu sınırlar ve harici yan etkiler için canlı arıza testi olmadan kayıpsız veya tam bir kez çalışma garantisi verilmemelidir.

## Uygulama sırası

### 1 Doğru sayaçlar ve iş bağlantıları

Backend background status sözleşmesine ready, unacknowledged, retryWaiting, failedMessages ve consumers ayrı alanlarla eklenir. Onay bekleyen sayı broker yönetim API'sinden veya izleme exporter'ından alınır; mevcut AMQP checkQueue bu alanı sağlamaz. Yönetim bilgileri yalnız backend'de kalır. Bu bağlantı kullanılamazsa alan bilinmiyor olarak döner, sıfır uydurulmaz.

Aktif, kilidi geçmiş, yeniden denenecek ve başarısız iş toplamları veritabanında aggregate ile hesaplanır. Liste sayfalıdır; toplamlar liste limitinden bağımsızdır. İsteğe göre ayrıntı listesi taşıma kaydını tarama, topic veya operation kaydıyla bağlar. Üst kartlar Aktif işler ve Kurtarma bekleyen işler ayrımını gösterir. Kuyruk tablosu Dinleyen çalışanlar ve İşlenmekte olan mesajlar alanlarını ayırır. Kayıt zamanı ve son başarı zamanı görünür olur.

Dosyalar: `backend/src/platform/rabbitmq.ts`, `backend/src/modules/workspace/workspace.routes.ts`, `frontend/src/features/workspace/api.ts`, `frontend/src/features/workspace/AutomationPages.tsx`.

Kabul: boş kuyruk ve bir tüketici durumunda aktif iş 0, dinleyen çalışan 1 görünür. 50'den fazla kayıtta toplam doğru kalır. Süresi geçmiş kilit aktif iş sayılmaz. Broker erişilemezse eski sayaçlar güncelmiş gibi gösterilmez.

### 2 Hata geçmişi ve başarısız iş yönetimi

Yapılandırılmış loglara zaman, olay tipi, queue, commandId, runId/topicId/taskId, attempt, worker instance ve güvenli hata kategorisi eklenir. Sağlayıcı tokenları, bağlantı parolaları, belge içerikleri ve kullanıcı mesajları loglanmaz. Hata neden zinciri güvenli alanlarla tutulur; UnknownError yerine adım ve hata kategorisi gösterilir.

Başarısız işler tarih ve çalışma bağlantısıyla listelenir. Eski olaylar ayrı tarih filtresinde görülebilir. Yeniden başlatma yeni komut kimliğiyle, güncel yetki ve idempotency kontrolünden geçer; başarısız kaydın durumunu değiştirip mesajı körlemesine geri atmaz. Başarısız mesaj ile veritabanı kaydı ilişkisi doğrulanır. İncelendi/arşivlendi aksiyonu geçmişi korur; toplu purge veya otomatik eski işleri tekrar çalıştırma yapılmaz.

Geçici ağ/429/5xx hataları gecikmeli yeniden denenir. Sağlayıcı izin hataları ve iptal edilmiş kullanıcı yetkisi otomatik tekrar döngüsüne sokulmaz; BLOCKED veya AWAITING_INPUT olarak açıklanır. Mevcut iş türlerinin özel retry davranışları korunarak ortak hata sınıflaması eklenir.

Kabul: 7 ve 8 Ekim hataları geçmiş olarak görünür; nedeni belirsiz kayıt belirsizliğini korur. Yeniden başlatma eski kaydı silmez ve aynı kullanıcı tıklamasından iki iş üretmez.

### 3 Kontrollü kapanış ve yeniden bağlantı

Worker'a tek sefer çalışan SIGTERM/SIGINT kapanış yordamı eklenir. Yeni relay/timer yayınları durdurulur, tüketiciler iptal edilir, devam eden işler sınırlı süre beklenir, ardından RabbitMQ, pg-boss ve DB bağlantıları kapatılır. Uzun iş süreyi aşarsa onaylanmamış mesaj yeniden teslim edilir; işin arşivlenmiş adımlardan güvenli devamı doğrulanır. Broker kopmasında supervisor yeniden başlatması korunur ve sebep loglanır. Normal kapanış ile arıza çıkış kodları ayrılır. Yayın ve keşif çağrılarına sınırlı bekleme eklenir; takılan confirm isteği relay'i sonsuza kadar kilitlememelidir.

Dosyalar: `backend/src/worker.ts`, `backend/src/platform/rabbitmq.ts`, `deploy/run-local.mjs`.

Kabul: boş worker kontrollü kapanır. Aktif iş kapanırken kaybolmaz; yeniden açılınca devam eder veya açık kurtarma durumu gösterir. Aynı rapor/revizyon iki kez üretilmez.

### 4 İzole arıza testleri ve dağıtım

`backend/test/integration/rabbitmq.test.ts` ayrı RabbitMQ vhost ve yalnız test veritabanında genişletilir. Başarılı iş, geçici hata, kalıcı hata, üç deneme sınırı, duplicate publish ve kayıp hedef kuyruğu mevcut testlerin temelidir. Ek olarak broker kopması, worker ölümü, kilit süresi dolması, DB erişim kaybı, confirm sonrası crash, ack öncesi crash ve SIGTERM denenir. Eşzamanlı iki worker'da aynı işin yan etkileri korunur. Mevcut yedi iş türü için mesaj sözleşmesi ve stale komut reddi kontrol edilir.

Sıra: backend sayaç sözleşmesi, frontend gösterimi, loglar ve hata sınıflaması, kontrollü kapanış, arıza testleri, yerel kabul. Gerçek kullanıcı kuyruğunda test mesajı, broker restart, kuyruğu silme veya failed mesajlarını tüketme yapılmaz. Gemini canlı erişimi bu taşıma testlerinin koşulu değildir; sahte işleyiciler kullanılır.

İzleme için ready/unacknowledged, tüketici sayısı, eski outbox yaşı, expired lease, başarısız iş artışı ve son başarı zamanı takip edilir. Alarm, yalnız broker ping sonucuna bağlanmaz. [RabbitMQ izleme rehberi](https://www.rabbitmq.com/docs/monitoring)

## Teslim ölçütü

Arayüz mesajı, tüketiciyi ve iş sonucunu doğru ayırır. Başarısız işlemin çalışma kaydına gidilebilir; geçmiş hata güncel kesinti gibi görünmez. Kapanış ve kopma senaryoları izole ortamda kanıtlanır. Mevcut otomasyon saatleri, kaynakları ve geçmiş kayıtlar korunur. Bu inceleme anındaki çalışma doğrulanmıştır; arıza altında kurtarma kabulü yukarıdaki testlerin geçmesine bağlıdır.
