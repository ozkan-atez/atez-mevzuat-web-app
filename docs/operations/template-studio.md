# Rapor şablonları — ana backend içindeki stüdyo

19 Ekim 2026 aktarımının kaynağı, localhost:8890 üzerinde çalışan Compose projesidir: `/Users/ozkan/Documents/GitHub/atez-mevzuat-web-app/.claude/worktrees/dev-2` (HEAD `d94ef4d`). Şablon/bileşen ekranları ve v2 stüdyo servisleri bu kaynaktan alınmıştır. Önceki yerel özel düzenleyici bu ekranların yerine kullanılmaz.

## Ekranlar ve servis

- `http://localhost:5173/templates`: şablon listesi, rapor tarifi, sistemin kullandığı biçim, bölüm seçimi, kaydetme ve önizleme.
- `/templates/components`: 15 başlangıç bileşeni, filtreler ve görsel önizleme.
- Sohbet: bileşen oluşturma/değiştirme araçları, taslak önizleme ve havuza kaydetme. Kaynak sürümde sohbetin çıktısı bileşen taslağıdır; tam şablon üretimi değildir.
- Tarayıcı `/api/v2/*` isteklerini mevcut API'ye gönderir. Oturum, CSRF ve `config.manage` denetiminden sonra yalnız stüdyo yolları yerel v2 servisine aktarılır.
- Stüdyo ana API sürecinde, ağ portu açmadan çalışır. Tarayıcı aynı `localhost:5173/api/v2/*` yolunu kullanır; istekler oturum/CSRF/yetki kontrolünden sonra süreç içinde işlenir. Ayrı 3101 dinleyicisi yoktur.
- `atez_studio_v2` veritabanı, şablon kimlikleri, sürümleri ve bileşenler korunur. Ana `atez_db` ile veritabanı birleştirmesi yapılmaz.
- Rapor worker’ı gerektiğinde aynı stüdyo modülünü kendi sürecinde kullanır; ayrı servise bağlanmaz.

20 Ekim 2026 geçişinde mevcut veritabanlarına migration uygulanmaz. Bağımlılıklar `backend/` ve `frontend/` içinde `npm ci`, `v2/` içinde `pnpm install --frozen-lockfile` ile kurulur. `deploy/install-local-services.sh` API/worker/web servislerini günceller ve eski ayrı stüdyo servisini durdurup devre dışı bırakır. Mevcut Vertex ayarları korunur. V2 tarama motoru, worker, relay ve scheduler bu geçiş kapsamında etkinleştirilmez.

`deploy/run-local.mjs` yerel kullanımda `COMPONENT_STUDIO_URL=http://embedded-studio` işaretini kullanır. Bu bir ağ adresi değil, süreç içi taşıma seçimidir. `STUDIO_DATABASE_URL` belirtilmezse yerel PostgreSQL bağlantısının `atez_studio_v2` veritabanı kullanılır; ana uygulama bağlantısı değiştirilmez. Stüdyo modülü ana veritabanıyla aynı veritabanı adına bağlanmayı reddeder. Eski `run-studio.mjs` yalnız bağımsız kullanım/geri dönüş için korunmuştur; normal kurulum onu başlatmaz.

## Mevcut rapor motoruyla bağlantı

Şablonlar mevcut `ReportTemplate` tablosuna kimlik ve sürümleri korunarak yansıtılır. `studioSnapshot` alanı şablon tanımını ve sürümü sabitlenmiş bileşenleri içerir. Sohbet ve otomasyon işinin başlangıcında bu snapshot dondurulur. Sonraki şablon değişiklikleri önceki raporları değiştirmez.

`v2/apps/api/src/legacy-reports.ts` ve `legacy-context.ts` mevcut rapor analizini v2 renderer'a bağlayan ek uyarlamalardır. Kaynak stüdyonun sözleşmeleri, servisleri ve renderer'ı değiştirilmez. Özet, operasyonel etki, etkilenen taraflar, doğrulanmış yürürlük tarihleri, kaynaklar ve belirsizlikler aktarılır. Önizleme örnek veri kullanır; gerçek rapor üretimi yalnız işin kanıtlarını kullanır.

Sınır: eski analiz sözleşmesindeki serbest metin karşılaştırmaları karşılaştırma notu olarak korunur; bunlardan v2'nin yapılandırılmış GTİP/oran satırları veya sayısal değişim yüzdeleri tahmin edilmez. V2 analiz hattının tamamı bu iş kapsamında mevcut tarama motorunun yerine geçirilmemiştir.

Mevcut eski HTML/definition şablonlarının rapor yolu korunur. Uygulanmış `20261019140000_template_studio` göçünün ek tabloları geri alınmaz; güncel stüdyo için otoritatif depolama v2 veritabanıdır. `20261019160000_link_v2_studio` snapshot bağlantısını ekler. Akademi kaldırma göçü ayrı tutulur.

## Doğrulama

Frontend şablon/bileşen/sohbet kartı testleri, v2 birim testleri, backend sohbet araçları ve proxy testleri çalıştırılır. Yerel tarayıcıda oluşturma, sürüm artırarak kaydetme, bileşen kapatma ve önizleme kontrol edilmiştir. Kurgu kaynakla canlı model üzerinden rapor tarifi derleme ve üç bölümlü rapor üretimi denenmiştir. Bu kontrol bütün GTİP/karşılaştırma senaryolarını kapsamaz.

Göç öncesi yerel yedek: `.local/backups/template-studio-20261019/before-studio.dump`. Yerel doğrulama çıktıları `.local/verification/studio/` altındadır; sürüm kontrolüne girmez.

## Dev aktarımı ve geri dönüş

Çalışan Antigravity sürümü `dev` dalının içerik tabanıdır; önceki dev geçmişi merge commit ile korunmuştur. Yeni V2 tarama/analiz backend entegrasyonu sonraki iştir. Yerel geçiş yedeği `.local/backups/dev-promotion-20261020/` altında iki PostgreSQL dump’ı, kaynak arşivi ve eski stüdyo servis tanımını içerir; GitHub’a gönderilmez.

Geri dönüşte kaynak arşivi veya geçiş öncesi commit kullanılıp eski servis kurulumu yeniden çalıştırılabilir. Veritabanı geçişi yapılmadığından bu değişiklik için veritabanı geri yüklemek gerekmez.

Doğrulama: backend tip kontrolü, ilgili 22 backend testi, 10 frontend testi ve üretim derlemesi; stüdyo dahil 79 V2 birim testi ve tip kontrolü. Mevcut stüdyonun 1 şablon/15 bileşen listesi süreç içi modülün yanıtlarıyla birebir karşılaştırılmış; 15 bileşenin önizlemesi ve şablon snapshot okuması doğrulanmıştır. 5173/3001 sağlık kontrolü ve oturumsuz stüdyo erişiminde 401 kontrol edilir; 3101 artık dinlemez. Canlı AI rapor üretimi bu geçiş doğrulamasında çalıştırılmamıştır.
