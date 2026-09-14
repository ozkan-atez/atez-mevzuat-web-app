# Resmî Gazete Manuel Veri Toplama Tasarımı

**Tarih:** 2026-09-13
**Durum:** Kullanıcı tarafından onaylanan tasarım
**Kapsam:** Yalnızca manuel Resmî Gazete veri toplama akışı

## 1. Amaç

Kullanıcının seçtiği bir yayın tarihi için Resmî Gazete'nin ana ve mükerrer sayılarını keşfetmek; yayımlanan HTML/PDF belgeleri ile bu belgelerin içinde başvurulan resmî ekleri ve görselleri indirmek; dosyaları değiştirilemez ham kaynak olarak S3 uyumlu nesne deposunda, ilişkisel üst veriyi PostgreSQL'de saklamak.

Bu aşamada içerik analizi, mevzuat sınıflandırması, rapor üretimi, e-posta dağıtımı ve cron çalıştırmaları kapsam dışındadır.

## 2. Temel kararlar

- Tek veri kaynağı Resmî Gazete'dir; uygulamada izin verilen alan adları `resmigazete.gov.tr` ve `www.resmigazete.gov.tr` olarak yapılandırılır.
- Manuel tarama, “Yeni Tarama Başlat” işlemiyle başlar.
- Seçilmeyen durumda hedef tarih `Europe/Istanbul` saat dilimine göre “bugün”dür.
- Aynı tarih yeniden tarandığında yeni bir çalışma kaydı oluşturulur; önceki çalışma değiştirilmez.
- Aynı içeriğe sahip dosyalar SHA-256 içerik adresleme sayesinde tekrar saklanmaz.
- Dosyaların kendisi PostgreSQL'e BLOB olarak yazılmaz.
- PostgreSQL yalnızca çalışma durumu, kaynak üst verisi, ilişkiler ve nesne deposu referanslarını tutar.
- Başarılı durum, zorunlu bütün belge ve varlıkların doğrulanıp kaydedilmesini gerektirir.

## 3. Sistem sınırı

### Kapsamda

- Tarihe göre ana sayı ve mükerrer sayı keşfi
- Resmî HTML ve PDF belgelerinin indirilmesi
- Belge içindeki resmî PDF ve görsel varlıkların keşfi
- TLS, alan adı, yönlendirme, dosya türü ve bütünlük doğrulaması
- Tekrarlanabilir ve denetlenebilir manuel çalışma kaydı
- S3 uyumlu nesne deposu
- PostgreSQL üst veri kaydı
- Canlı işlem durumu ve açıklamalı hata görünürlüğü

### Kapsam dışında

- Cron zamanlayıcılarının çalıştırılması
- IGMD, Ticaret Bakanlığı, mevzuat.net veya başka kaynaklar
- Yapay zekâ analizi ve mevzuat ilgililik değerlendirmesi
- Rapor/bülten üretimi
- Microsoft Graph ve e-posta dağıtımı
- Belge içeriğini kullanıcı adına değiştirme

## 4. Mimari

```text
Frontend
   |
HTTP API + canlı olay akışı
   |
Application Use Cases
   |
Domain
   |
+----------------+------------------+----------------+
| Job Queue Port | Object Store Port| Repository Port|
+----------------+------------------+----------------+
        |                 |                  |
     pg-boss       S3 uyumlu depo       PostgreSQL
                          |
                  AWS SDK S3 Adapter

Resmî Gazete Adapter ---> doğrulanmış HTTPS istekleri
```

Domain ve application katmanları AWS, MinIO veya belirli bir HTTP kütüphanesine bağımlı değildir. Altyapı ayrıntıları port/adapter sınırının dışında kalır.

## 5. Nesne depolama modeli

Bucket adı:

```text
resmi-gazete
```

Anahtar düzeni:

```text
runs/YYYY/MM/DD/{runId}/index.html
runs/YYYY/MM/DD/{runId}/manifest.json
objects/sha256/ab/cd/{fullSha256}.pdf
objects/sha256/ef/12/{fullSha256}.png
objects/sha256/34/56/{fullSha256}.html
```

`runs` alanı belirli bir çalışmanın tarihsel kaydını, `objects` alanı ise içerik adresli gerçek dosyaları tutar. Manifest; bulunan yayınları, kaynak URL'lerini, SHA-256 değerlerini, nesne anahtarlarını ve doğrulama sonuçlarını birbirine bağlar.

Yerel geliştirmede S3 uyumlu bir Docker servisi kullanılabilir. Üretimde AWS S3 veya aynı sözleşmeyi sağlayan yönetilen bir nesne deposuna geçiş yalnızca yapılandırma değişikliği gerektirmelidir.

## 6. İşlem durum makinesi

```text
QUEUED
  -> DISCOVERING
  -> DOWNLOADING_DOCUMENTS
  -> DISCOVERING_ASSETS
  -> DOWNLOADING_ASSETS
  -> VALIDATING
  -> WRITING_MANIFEST
  -> COMPLETED
```

Her aşama aşağıdaki sonuçlardan biriyle biter:

- `COMPLETED`: Aşamanın bütün zorunlu işleri tamamlandı.
- `FAILED`: Devam edilmesini engelleyen kalıcı hata oluştu.
- `PARTIAL`: Bazı çıktılar saklandı ancak çalışma başarı ölçütünü karşılamadı.
- `CANCELLED`: İleride eklenecek kontrollü iptal davranışı için ayrılmış durum.

Bir sonraki aşama ancak önceki aşamanın zorunlu işleri tamamlandığında başlar. Aynı aşamadaki bağımsız indirmeler sınırlı eşzamanlılıkla yürütülebilir.

## 7. Veri modeli

### ScanRun

- `id`
- `trigger`: şimdilik yalnızca `MANUAL`
- `targetDate`
- `timezone`: `Europe/Istanbul`
- `status`
- `currentStage`
- `startedAt`, `completedAt`
- toplam/biten/başarısız iş sayaçları
- hata özeti

### GazetteEdition

- `id`, `runId`
- yayın tarihi
- tür: `MAIN` veya `SUPPLEMENT`
- mükerrer sıra numarası
- fihrist/kaynak URL'si
- keşif sırası

### Document

- `id`, `editionId`
- başlık ve yayın sırası
- kaynak URL'si
- belge türü
- ham içerik nesne referansı
- doğrulama durumu

### StoredObject

- `id`
- `sha256` (benzersiz)
- `bucket`, `objectKey`
- gerçek medya türü
- byte boyutu
- ilk görülme zamanı
- S3 sürüm/checksum bilgisi

### DocumentAsset

- `documentId`, `storedObjectId`
- orijinal URL ve belge içindeki referans
- rol: `ATTACHMENT`, `IMAGE`, `STYLESHEET_ASSET` veya `OTHER_SUPPORTED`

### StageExecution

- `runId`, aşama adı, durum
- başlangıç/bitiş zamanı
- toplam/biten/başarısız iş sayısı
- hata özeti

### FetchAttempt

- hedef URL ve bağlı çalışma/belge
- deneme numarası
- başlangıç/bitiş zamanı
- HTTP durumu
- yönlendirme hedefi
- alınan byte sayısı
- hata sınıfı ve güvenli hata açıklaması

## 8. Resmî Gazete keşif kuralları

1. Hedef tarihin günlük sayfası denenir.
2. Gerekirse aynı tarihin resmî arşiv yolu kullanılır.
3. Yalnızca hedef tarihle eşleşen ana ve mükerrer yayınlar kabul edilir.
4. Belge ve varlık URL'leri izin verilen resmî alan adlarında kalmalıdır.
5. Belgenin bulunduğu resmî dizinin dışına çıkan göreli yollar ve `..` geçişleri reddedilir.
6. `<base href>`, `img/src`, `source/src`, `srcset` ve CSS `url(...)` referansları güvenli biçimde çözülür.
7. Desteklenen görseller başlangıçta BMP, GIF, JPEG, PNG ve WebP'dir.
8. Bağlı PDF ekleri indirilir; kapsam genişletilecekse izin verilen türler açık listeyle eklenir.

## 9. Güvenlik ve erişim dayanıklılığı

- TLS doğrulaması zorunludur; güvensiz tekrar denemesi yapılmaz.
- İzin verilen alan adları yapılandırmada açıkça tanımlanır.
- Dış alana yönlendirmeler reddedilir.
- Açıklayıcı ve sabit bir `User-Agent` kullanılır.
- İstekler arasında yaklaşık 750 ms kaynak-dostu bekleme uygulanır.
- Bağlantı ve toplam yanıt zaman aşımı ayrı ayrı tanımlanır.
- `429` ve geçici `5xx` yanıtları artan bekleme ve jitter ile en fazla üç kez denenir.
- `404`, dış alan yönlendirmesi, dosya türü uyuşmazlığı ve güvenlik ihlali otomatik denenmez.
- Yanıtın uzantısına veya `Content-Type` başlığına tek başına güvenilmez; PDF ve görsel magic byte kontrolü yapılır.
- Maksimum dosya boyutu ve toplam çalışma indirme kotası yapılandırılır.
- HTML içinde gömülü kimlik bilgileri veya hassas başlıklar loglanmaz.

## 10. Tutarlılık ve hata davranışı

S3 ve PostgreSQL ortak bir transaction paylaşmadığından uygulama aşağıdaki düzeni kullanır:

1. Dosya stream edilirken SHA-256 hesaplanır ve içerik doğrulanır.
2. İçerik adresli nesne idempotent biçimde depoya yazılır.
3. `StoredObject` kaydı benzersiz SHA-256 üzerinden upsert edilir.
4. Belge ve varlık ilişkileri çalışma transaction'ında kaydedilir.
5. Manifest en son yazılır.
6. Çalışma yalnızca manifest ve bütün zorunlu ilişkiler doğrulandıktan sonra `COMPLETED` olur.

Başarısız çalışma tarafından yazılmış fakat hiçbir tamamlanmış manifest tarafından kullanılmayan nesneler, daha sonra güvenli bir çöp toplama göreviyle temizlenebilir. Manuel tarama akışında otomatik ve yıkıcı silme yapılmaz.

## 11. API sözleşmesi

### Manuel çalışma başlatma

```http
POST /api/v1/scan-runs
Idempotency-Key: <client-generated-id>
Content-Type: application/json

{
  "trigger": "MANUAL",
  "targetDate": "2026-09-13"
}
```

Yanıt:

```http
202 Accepted

{
  "runId": "uuid",
  "status": "QUEUED",
  "targetDate": "2026-09-13"
}
```

`Idempotency-Key`, çift tıklama veya ağ tekrarında yanlışlıkla iki ayrı çalışma oluşmasını engeller. Kullanıcı daha sonra bilinçli olarak aynı tarihi yeniden başlatırsa yeni anahtarla yeni çalışma oluşturulur.

### Çalışma durumu

```http
GET /api/v1/scan-runs/{runId}
GET /api/v1/scan-runs/{runId}/events
```

Canlı olay akışı kesilirse frontend durum endpoint'inden devam edebilir. Arayüzde gösterilen bütün sayaçlar gerçek backend verisinden gelir.

## 12. Arayüz davranışı

- “Yeni Tarama Başlat” gerçek API çağrısını yapar.
- Backend `202` dönmeden detay sayfasına gidilmez.
- İstek sürerken buton tekrar gönderimi engeller.
- Detay sayfası aşama, ilerleme, bulunan yayınlar, belge/varlık sayıları ve hataları gösterir.
- Frontend hata durumunda sahte başarı veya örnek çalışma kimliği üretmez.
- Cron zaman çizelgesi mevcut tasarımda görsel olarak kalabilir; bu aşamada manuel çalışmaya bağlı değildir.
- Teknik hata metinleri kullanıcıya güvenli ve anlaşılır özetle sunulur; ayrıntı denetim kaydında korunur.

## 13. Gözlemlenebilirlik

- Bütün loglar `runId`, `stage`, `documentId` ve güvenli kaynak host bilgisi taşır.
- URL query parametreleri varsayılan olarak maskelenir.
- Aşama süreleri, indirilen byte, tekrar deneme ve hata sınıfı metrikleri üretilir.
- Health check; API, PostgreSQL, job queue ve nesne deposunu ayrı ayrı raporlar.
- Bir çalışma tamamlandığında manifest ile veritabanı sayaçları karşılaştırılır.

## 14. Test stratejisi

### Birim testleri

- Ana/mükerrer sayı ayrıştırma
- Tarih ve saat dilimi kuralları
- URL allowlist ve path traversal reddi
- `<base>`, `srcset` ve CSS URL çözümleme
- MIME ve magic byte doğrulama
- tekrar deneme sınıflandırması
- durum makinesi geçişleri
- içerik adresleme ve manifest üretimi

### Entegrasyon testleri

- Kaydedilmiş Resmî Gazete fixture'larıyla uçtan uca keşif
- PostgreSQL ve S3 uyumlu test deposuyla kalıcılık
- aynı dosyanın iki çalışmada tekrar depolanmaması
- yarım indirme ve bağlantı kesilmesi
- dış alan yönlendirmesi ve sahte PDF reddi
- worker yeniden başlatıldığında idempotent devam

### Sözleşme ve arayüz testleri

- `POST /scan-runs` doğrulaması ve idempotency
- canlı olay akışı kesildiğinde durum endpoint'ine dönüş
- frontend'in hata durumunda sahte başarı üretmemesi
- detay sayfasının backend sayaçlarıyla tutarlılığı

Canlı Resmî Gazete sitesi test paketinin zorunlu koşulu yapılmaz; değişken dış kaynağa karşı ayrı, kontrollü smoke testi kullanılır.

## 15. Dağıtım bileşenleri

Yerel Docker kurulumu en az şu servisleri içerir:

- `frontend`
- `api`
- `worker`
- `postgres`
- `s3-compatible-storage`

API ve worker aynı domain/application kodunu paylaşır ancak ayrı process olarak ölçeklenebilir. Üretimde nesne deposu endpoint ve credential yapılandırması değiştirilerek AWS S3'e geçilir.

## 16. Tamamlanma ölçütleri

- Kullanıcı hedef tarihi seçerek gerçek bir manuel çalışma başlatabilir.
- Ana ve mükerrer Resmî Gazete sayıları eksiksiz keşfedilir.
- Resmî HTML/PDF ve desteklenen belge içi varlıklar indirilir.
- Bütün nesneler SHA-256 ve gerçek içerik türüyle doğrulanır.
- Aynı içerik yeniden saklanmaz.
- Çalışma ve nesne ilişkileri PostgreSQL'de sorgulanabilir.
- Manifest, veri tabanı kayıtlarıyla tutarlıdır.
- Eksik veya geçersiz veri başarılı gösterilmez.
- Detay sayfası gerçek işlem ilerlemesini ve açıklamalı hataları gösterir.
- Mevcut cron görseli korunur ancak manuel akıştan ayrıdır.
