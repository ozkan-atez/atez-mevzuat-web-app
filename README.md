# ATEZ Mevzuat Web App

Bu sürüm, manuel olarak seçilen bir tarih için Resmî Gazete ana ve mükerrer sayılarını; belgeleri ve belge içindeki desteklenen dosyaları toplar. Analiz, raporlama ve e-posta dağıtımı bu aşamanın kapsamı dışındadır.

## Yerelde çalıştırma

Docker Desktop açıkken proje kökünde:

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f backend worker
```

İlk açılışta backend veritabanı migration'larını otomatik uygular. Gerekirse elle tekrar çalıştırılabilir:

```bash
docker compose exec backend npm run prisma:migrate
```

Uygulama `http://localhost:8888`, API sağlık bilgisi `http://localhost:8888/api/health`, MinIO yönetim ekranı ise `http://localhost:9001` adresindedir. Yerel MinIO kullanıcı bilgileri `.env.example` içindeki geliştirme değerleridir.

Yerel nesne deposundaki `resmi-gazete` bucket'ı backend ve worker tarafından idempotent biçimde oluşturulur. Aynı dosyanın tekrar indirilmesi yeni bir byte kopyası üretmez; SHA-256 anahtarıyla mevcut nesne kullanılır.

## Üretim

Sabit digest ile tanımlanan MinIO servisi yalnızca yerel geliştirme içindir. `docker-compose.prod.yml` yerel nesne deposu veya erişim anahtarı içermez. Üretimde `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` ve `S3_SECRET_ACCESS_KEY` değerleri deployment secret store üzerinden verilmeli; standart S3 servisleri için `S3_FORCE_PATH_STYLE=false` kullanılmalıdır.

Üretim yapılandırmasını doğrulama örneği:

```bash
docker compose -f docker-compose.prod.yml config
```
