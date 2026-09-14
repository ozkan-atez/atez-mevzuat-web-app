# ATEZ Mevzuat Web App

Bu sürüm, manuel olarak seçilen bir tarih için Resmî Gazete ana ve mükerrer sayılarını; ilanlar dahil tüm belgeleri ve belge içindeki desteklenen dosyaları toplar. Başlık ve gerektiğinde içerik tabanlı Gemini filtresinden geçen her ilgili belge bağımsız analiz edilir, önceki resmî kaynağıyla ilişkilendirilir ve tek kartlı ATEZ HTML bültenine dönüştürülür. İlgili değişiklik yoksa Gemini çağrısı yapılmadan `00-degisiklik-yok.html` üretilir.

## Yerelde çalıştırma

Docker Desktop açıkken proje kökünde:

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f backend worker
```

İlk taramadan önce `.env` içinde geçerli bir `GEMINI_API_KEY` bulunmalıdır. Varsayılan geliştirme modeli `gemini-3.7-flash` olup topic analizleri `TOPIC_ANALYSIS_CONCURRENCY` sınırıyla birbirinden bağımsız çalışır.

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
