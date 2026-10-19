# V2 backend geçişi — 20 Ekim 2026

Yerel Antigravity uygulaması `dev` dalında çalışır. `deploy/run-local.mjs` yeni Resmî Gazete taramaları için `SCAN_ENGINE=v2` seçer. Frontend aynı 5173 portunda, API aynı 3001 portundadır. V2 worker, orchestrator, relay ve reaper ana worker sürecinin içinde başlar; ayrı API veya scheduler açılmaz.

## Veri ve iş yalıtımı

- Ana PostgreSQL veritabanı ve mevcut raporlar taşınmaz. V2 kendi `STUDIO_DATABASE_URL` veritabanını kullanır; canlı veritabanlarında migration çalıştırılmaz.
- `V2_AMQP_URL` ayrı RabbitMQ virtual host kullanmalıdır. Yerel varsayılan `atez-v2`; eski motorun `/` kuyruğu korunur. `node deploy/ensure-v2-queue.mjs` bu alanı idempotent hazırlar; servis kurulum betiği de çağırır.
- Yeni taramanın motor seçimi `workspaceConfig.engine` içinde sabitlenir. Tarihî kayıtların yeniden denenmesi eski motoru kullanır. Stüdyo karşılığı olmayan eski özel şablonlar mevcut motorla çalışır. RG dışındaki kaynak bağlayıcıları mevcut akışlarını sürdürür.
- Kuyruk teslim kimliği V2 çalışma kimliğine dönüştürülür. Tekrar teslim aynı çalışmayı sürdürür. Rapor ve belge aktarımı idempotenttir; kullanıcının daha yeni rapor revizyonunu değiştirmez.
- Stüdyo şablon sürümü V2 çalışma başlangıcında sabitlenir. Tarama sırasındaki şablon değişikliği analizi değiştirmez.
- Aşamalar, filtre sonuçları, belgeler, ekler, kullanım kayıtları ve raporlar mevcut ekranların okuduğu kayıtlara aktarılır. Kullanıcı/çalışma alanı sahipliği korunur. V2 raporları aynı düzeltme ekranında düzenlenip yeni sürüm olarak kaydedilebilir.
- Doğrulama bekleyen V2 raporu başarılı çıktı gibi gösterilmez. İlgili belge bulunmayan başarılı günlerde K6 değişiklik yok raporu üretilir.

## Doğrulama

V2 testleri gerçek test PostgreSQL, RabbitMQ ve MinIO üzerinde; RG/TARIFF/AI sağlayıcıları kontrollü fixture ile çalıştırıldı. 121 test geçti. Ana uygulamada 12 hedefli test geçti. Ek testler teslim idempotensi, şablon sürümünün korunması, ana uygulamaya aktarım, kullanıcı yalıtımı, hata durumu ve rapor düzeltme/yayımlama uçlarını kapsar. İlgili frontend testlerinde 42 test geçti. Backend ve frontend derlemeleri ile V2 typecheck çalıştırıldı.

Geniş regresyon taramasında değişiklik öncesi `28e2ca1` arşiviyle karşılaştırma yapıldı: backend'deki 22 test hatası ve frontend'deki 4 test hatası aynı testlerde yeniden üretildi. Bu nedenle tüm projenin test paketi tamamen yeşil değildir. V2'ye ait hedefli kontroller ayrı değerlendirilmelidir. Backend testlerinde özel 45432 PostgreSQL ve 59000 MinIO ortamı kullanılır; canlı veritabanı test hedefi değildir.

Yerel çalışma çıktıları `.local/*v2*.log`, karşılaştırma kayıtları `.local/*baseline-tests.log` altındadır. Geçiş öncesi iki veritabanının yedeği `.local/backups/v2-integration-20261020/` altındadır; Git'e eklenmez.

## Geri dönüş

Yeni taramaları eski motora yönlendirmek için yerel yapılandırmada `SCAN_ENGINE=legacy` seçilip API ve worker yeniden başlatılır. Önceden V2 olarak oluşturulmuş çalışmalar V2 olarak kalır. Kuyruk veya veritabanı silmek gerekmez. Çalışan iş sırasında restart yapılırsa ana kuyruğun 90 saniyelik lease süresi dolduktan sonra yeniden teslim aynı V2 çalışmasını sürdürür.

Canlı yerel QA: 19.10.2026 tarihi için V2 taraması 13 kayıt buldu, kapsam değerlendirmesi sonrasında değişiklik yok raporu üretti. Aynı uygulamada yeniden deneme, tarama aşamaları ve rapor görüntüleme kontrol edildi. Rapor içeren analiz/karşılaştırma senaryoları gerçek test altyapısında kontrollü RG/TARIFF/AI fixture ile doğrulandı.
