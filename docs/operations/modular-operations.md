# Modüler belge ve işlem sistemini çalıştırma

Bu geçiş belge arşivini, bağımsız işlem kuyruğunu ve çalışma dışında oluşturulan rapor taslaklarını ekler. Eski taramalar, raporlar ve zamanlanmış işlerin yürütücüsü korunur. Yeni raporlar kullanıcı yayımlayana kadar taslaktır; e-posta gönderimi başlatılmaz.

## Etkinleştirme ve erişim

API ve worker aynı `MODULAR_OPERATIONS_ENABLED=true` ayarıyla başlatılmalıdır. Varsayılan değer kapalıdır. Önce veritabanının yedeğini alın ve `backend` dizininde `npm run prisma:migrate` çalıştırın. Üç ek migration mevcut kayıtları silmeden belge sürümleri, görevler, taslak bağlantıları ve kaynak çalışması ilişkilerini ekler.

Bu sürüm yerel çalışma alanını kullanır. Yeni belge ve işlem uçları loopback erişimiyle sınırlıdır. Paylaşılan dağıtım için kimliği doğrulanmış kullanıcıdan aktör kapsamını çözmek ve bütün belge, işlem, sohbet ve rapor yollarında aynı yetkilendirmeyi uygulamak gerekir. İstemciden gelen aktör kapsamı kabul edilmez.

Yerel servisler `deploy/run-local.mjs` üzerinden `.env` ayarlarını okur. Değişiklikten sonra API ve worker yeniden başlatılmalıdır. Frontend için `frontend` dizininde `npm run build` gerekir. Sağlık kontrolünde işlem kuyruğunun worker tüketicisi bulunmalıdır.

## Eski belgeleri arşive eşleme

`backend/scripts/backfill-document-archive.ts` varsayılan olarak dry-run yapar. Uygulama için `--apply` verilir; doğru `DATABASE_URL` hedefini operatör açıkça sağlamalıdır. Betik 100 kayıtlık partilerle idempotent eşleme yapar. Dosya indirmez veya AI çağırmaz. Saklanan bayt ya da mevcut metin varsa sürüm oluşturur; eksik içerik ve bilinmeyen tarihleri uydurmaz.

11 Ekim 2026 yerel geçişinde 752 toplanmış belge ve 38 kaynak belgesi incelendi; 507 eski belge kaydı eşlendi; yinelenen girdiler ortak 181 belge ve 184 sürümde birleştirildi. 321 kayıtta kullanılabilir bayt/metin eksikliği raporlandı. Eski 80 tarama, 38 sohbet mesajı ve 58 rapor korunmuştur. Yedek özel izinlerle yerel Codex yedek dizininde saklanır.

## İşlemlerin kullanımı

Belge arşivinde dosya, metin veya URL eklenebilir. PDF, DOCX, XLSX, CSV ve TXT için metin çıkarılır. Görseller ve metinsiz taranmış PDF için `OCR_REQUIRED` durumu gösterilir; OCR sağlayıcısı eklenene kadar bu belgeler analiz girdisi olamaz. Dosya sınırı 20 MB, seçili analiz paketi en fazla 10 sürümdür.

Kaynak keşfi, belge ve eklerini indirme, metin çıkarma, filtreleme, önceki kaynak araştırması, Tariff sorgusu, analiz, rapor üretme ve revizyon ayrı işlemlerdir. `REUSE_ONLY` yeni dış çağrı yapmaz; `FILL_MISSING` yalnız gerekli eksik aşamaları ekler; `FORCE` seçilen aşamayı yeniden yürütür. İsteklerde aynı girdilerle aynı `Idempotency-Key` tekrar kullanılır. Aynı anahtarla farklı girdi 409 döndürür.

Otomasyon ayrıntısındaki tek adım işlemi otomasyon ayarını kullanır ve sonucu otomasyona bağlar. Eski tam çalışma düğmesi ve cron zamanlayıcı mevcut tarama motorunu kullanmaya devam eder. Zamanlanmış bütün aşamaların yeni görevlere taşınması bu geçişte tamamlanmamıştır.

Analiz kanıtları seçilmiş belge sürümündeki gerçek alıntılarla doğrulanır. Tariff çıktısı arşivlenebilir ve destekleyici kanıt olarak analize eklenebilir; resmî yayın diye gösterilmez. Raporun kurumsal ATEZ iskeleti sabittir. Başlık, özet ve analiz içeriği düzenlenebilir. Yayımlama sürüm kontrolüyle yapılır; eski rapor sürümleri korunur.

## Hatalar ve yeniden deneme

İşlem ekranı kalıcı görev durumunu, hata kategorisini, kullanılan sürümleri ve çıktıları gösterir. `PARTIAL` sonucu tam başarı değildir. Başarısız, engellenmiş veya kısmi görev tekrar denenebilir. İptal edilen ya da worker lease süresi biten görev eski worker sonucuyla başarılıya çevrilemez.

Gemini erişim/izin hataları tekrar tekrar kuyruklanmaz. Sağlayıcı bağlantısı düzelene kadar arşivleme, metin çıkarma, kayıt sorguları ve mevcut analizden rapor üretme kullanılabilir. Analiz, AI filtreleme ve önceki kaynak atıflarını çıkarma sağlayıcı gerektirir. Tariff bağlantısı yoksa açık yapılandırma hatası döner.

## Doğrulama ve geri dönüş

Veritabanı kullanan testler yalnız açık `TEST_DATABASE_URL` ile adı `_test` biten ayrı veritabanında çalıştırılır. Aynı veritabanını kullanan test dosyaları `--no-file-parallelism` ile sırayla yürütülür. Modüler entegrasyon testleri ayrıca izole 45432 portunu doğrular; AI, Tariff ve nesne deposu sahtedir. Uygulama veritabanını temizleyen test hazırlığı çalıştırılmaz.

Sorunda `MODULAR_OPERATIONS_ENABLED=false` yapıp API ve worker yeniden başlatılır. Yeni iş kabulü ve modüler yürütücü kapanır; ek tablolar ve saklanan içerik korunur. Yeni veriler oluştuktan sonra migration geri alınmaz. Bekleyen outbox ve görev kayıtları yeniden etkinleştirmede devam edebilir. Eski tarama ve rapor okuma yolları kullanılabilir.

Bağımsız analizler sürümlü `OperationArtifact` içinde tutulur. Eski `AnalysisRevision/EvidenceBundle` modelinin bütünüyle ortaklaştırılması, cron motorunun yeni görevlerle yürütülmesi, OCR ve paylaşılan kullanıcı yetkilendirmesi ayrı kalan geliştirmelerdir. Canlı Gemini doğrulaması sağlayıcı bağlantısı düzeldikten sonra yapılmalıdır.
