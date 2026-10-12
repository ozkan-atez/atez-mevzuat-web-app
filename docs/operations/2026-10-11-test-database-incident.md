# 11 Ekim 2026 yerel test veritabanı olayı

Bu geliştirme sırasında çalıştırılan `scan-runs.routes` sözleşme testi, ayrı test veritabanı açıkça verilmediği için Prisma'nın uygulama `.env` bağlantısını kullandı. Testin `scanRun.deleteMany()` hazırlığı yerel `atez_db` tarama kayıtlarını ve bunlara bağlı kayıtları sildi. İşlem kullanıcı tarafından istenmedi; geliştirme hatasıdır. Kullanıcı olay ve kurtarma sınırları konusunda bilgilendirildi.

İşçi durduruldu. Olay sonrası veritabanı ve mevcut WAL dosyaları korundu. 10 Ekim tarihli `/tmp/atez-before-source-capture.dump` ayrı `atez_recovery_20261011` veritabanına açıldı. Yedekteki kayıtlar mevcut kimlikleri ezmeden eklendi: 73 tarama ve 58 rapor geri geldi. Otomasyon ayarları ve MinIO dosyaları silinmemişti. Otomatik bakım silinen satırları temizlemişti; WAL arşivleme kapalıydı. Bu yüzden yedekten sonraki tüm işlem ayrıntılarının geri getirildiği söylenemez.

MinIO ve işçi kayıtlarından üç zamanlanmış çalışma kimliği yeniden oluşturuldu; eksik ayrıntıları nedeniyle açıklamalı FAILED durumundalar:

- `2c8ad791-fbaa-4a2a-8a98-b01daf06a233` — 10 Ekim GUN_SONU
- `2d3609d2-855f-4869-902a-a8f7591bb8c5` — 11 Ekim MUKERRER_1
- `1de339ff-e923-4769-94b8-0f40c119ccb6` — 11 Ekim MUKERRER_2

Kullanıcının `7d2f73a5-e884-46a8-a795-7de88798c537` çalışması önceki doğrulanmış API gözleminden, yalnızca bilinen bilgilerle PARTIAL olarak yeniden oluşturuldu. Kurtarma işareti çalışma ayarlarında bulunur. Bir zamanlayıcı çalışması olay sırasında yeniden oluşmuştu. Kurtarma sonrası, yeni doğrulama çalışmaları öncesi toplam 78 tarama ve 58 rapor vardı. Bu sayı tam ve kayıpsız kurtarma kanıtı değildir.

Kurtarma sonrası yedek: `~/.codex/backups/atez-mevzuat-web-app/recovered-before-profiles-20261011.dump`. Olay sonrası yedek: `/tmp/atez-after-test-incident-20261011.dump`. WAL kopyası: `/tmp/atez-incident-wal-20261011.tar.gz`. Bunlar kaynak kod deposuna eklenmemelidir. Test bağlantısı artık açık ayrı test adresi olmadan kapalıdır; yeni testler `atez_profiles_test` üzerinde çalıştırıldı.
