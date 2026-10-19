# Rapor şablonları — dev stüdyosu

19 Ekim 2026 aktarımının kaynağı, localhost:8890 üzerinde çalışan Compose projesidir: `/Users/ozkan/Documents/GitHub/atez-mevzuat-web-app/.claude/worktrees/dev-2` (HEAD `d94ef4d`). Şablon/bileşen ekranları ve v2 stüdyo servisleri bu kaynaktan alınmıştır. Önceki yerel özel düzenleyici bu ekranların yerine kullanılmaz.

## Ekranlar ve servis

- `http://localhost:5173/templates`: şablon listesi, rapor tarifi, sistemin kullandığı biçim, bölüm seçimi, kaydetme ve önizleme.
- `/templates/components`: 15 başlangıç bileşeni, filtreler ve görsel önizleme.
- Sohbet: bileşen oluşturma/değiştirme araçları, taslak önizleme ve havuza kaydetme. Kaynak sürümde sohbetin çıktısı bileşen taslağıdır; tam şablon üretimi değildir.
- Tarayıcı `/api/v2/*` isteklerini mevcut API'ye gönderir. Oturum, CSRF ve `config.manage` denetiminden sonra yalnız stüdyo yolları yerel v2 servisine aktarılır.
- V2 API `127.0.0.1:3101`, ayrı `atez_studio_v2` veritabanıyla çalışır. 8890 kaynak uygulamasının veritabanı değiştirilmez.

`node deploy/run-studio.mjs migrate` stüdyo veritabanı göçlerini, `node deploy/run-studio.mjs` API'yi çalıştırır. Veritabanı önceden oluşturulmalıdır. `deploy/install-local-services.sh` stüdyo/API/worker servislerini kurar. Stüdyo servisi mevcut Vertex yapılandırmasını kullanır. V2 worker/scheduler bu aktarım için başlatılmaz.

## Mevcut rapor motoruyla bağlantı

Şablonlar mevcut `ReportTemplate` tablosuna kimlik ve sürümleri korunarak yansıtılır. `studioSnapshot` alanı şablon tanımını ve sürümü sabitlenmiş bileşenleri içerir. Sohbet ve otomasyon işinin başlangıcında bu snapshot dondurulur. Sonraki şablon değişiklikleri önceki raporları değiştirmez.

`v2/apps/api/src/legacy-reports.ts` ve `legacy-context.ts` mevcut rapor analizini v2 renderer'a bağlayan ek uyarlamalardır. Kaynak stüdyonun sözleşmeleri, servisleri ve renderer'ı değiştirilmez. Özet, operasyonel etki, etkilenen taraflar, doğrulanmış yürürlük tarihleri, kaynaklar ve belirsizlikler aktarılır. Önizleme örnek veri kullanır; gerçek rapor üretimi yalnız işin kanıtlarını kullanır.

Sınır: eski analiz sözleşmesindeki serbest metin karşılaştırmaları karşılaştırma notu olarak korunur; bunlardan v2'nin yapılandırılmış GTİP/oran satırları veya sayısal değişim yüzdeleri tahmin edilmez. V2 analiz hattının tamamı bu iş kapsamında mevcut tarama motorunun yerine geçirilmemiştir.

Mevcut eski HTML/definition şablonlarının rapor yolu korunur. Uygulanmış `20261019140000_template_studio` göçünün ek tabloları geri alınmaz; güncel stüdyo için otoritatif depolama v2 veritabanıdır. `20261019160000_link_v2_studio` snapshot bağlantısını ekler. Akademi kaldırma göçü ayrı tutulur.

## Doğrulama

Frontend şablon/bileşen/sohbet kartı testleri, v2 birim testleri, backend sohbet araçları ve proxy testleri çalıştırılır. Yerel tarayıcıda oluşturma, sürüm artırarak kaydetme, bileşen kapatma ve önizleme kontrol edilmiştir. Kurgu kaynakla canlı model üzerinden rapor tarifi derleme ve üç bölümlü rapor üretimi denenmiştir. Bu kontrol bütün GTİP/karşılaştırma senaryolarını kapsamaz.

Göç öncesi yerel yedek: `.local/backups/template-studio-20261019/before-studio.dump`. Yerel doğrulama çıktıları `.local/verification/studio/` altındadır; sürüm kontrolüne girmez.
