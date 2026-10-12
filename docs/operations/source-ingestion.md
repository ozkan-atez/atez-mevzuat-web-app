# Kaynak tarama altyapısı

11 Ekim 2026 uygulaması. Ana zamanlayıcı yalnızca `resmi-gazete` seçer. Kullanıcı otomasyonları seçili kaynak anahtarlarını ve tarih politikasını çalışma kaydına kopyalar. Kaynak sayfasındaki elle tarama da `/api/v1/scan-runs` üzerinden aynı ana iş kaydını oluşturur.

## Ortak işleme

Her harici kaynakta ACCESS → DISCOVERY → CAPTURE → VALIDATION → FILTER → PREVIOUS_SOURCES → ANALYSIS → REPORT → COMPLETE adımları kalıcı kaydedilir. Kaynak başarısızlığı diğer kaynakları engellemez; ana iş kısmi sonuç gösterebilir. Resmî Gazete'nin mevcut yayın/sayı bağlayıcısı korunur. Filtre, önceki resmî kaynak araması, analiz ve rapor hizmetleri paylaşılır; sitelere ait erişim/liste kuralları profillerdedir.

`SourceProfile` sürümlenir. Yeni keşif taslaktır, doğrulama liste ve örnek içeriğe erişimi sınar. Çalışma başlayınca profil kopyası saklanır; sonraki profil değişikliği yeniden denemede uygulanmaz. Hazır profiller mevcut beş kaynak için bulunur. Tarayıcı keşfi en fazla sekiz sayfa inceler; her sitede otomatik doğru kural üretme garantisi yoktur. Eksik kapsam başarı diye sunulmaz.

`PUBLISHED_DATE` yalnızca hedef gün yayımlananları seçer. Tarihsiz içerikler envanterde kalır ve bilgi notu olarak gösterilir; günlük seçim dışında kalmaları tek başına PARTIAL oluşturmaz. Erişim, bozuk liste, arşiv ve tarama sınırı sorunları PARTIAL/FAILED olarak korunur. `NEW_OR_CHANGED` görünen kapsam içindeki tarihli/tarihsiz belgeleri içerik ve dosya özetleriyle karşılaştırır; başarılı işleme makbuzları otomasyona göre ayrıdır. İlk tarama profildeki sınırlar içinde başlangıç envanterini işler. Bu politika harici kaynaklar içindir; Resmî Gazete günlük yayın akışını kullanır. Site arşivi/sayfalama veya profil sınırı dışındaki eski değişikliklerin keşfi garanti edilmez.

HTML, PDF, DOCX, XLSX, metin, görsel ve bağlantılı dosyaların asılları arşivlenir. DOCX/XLSX metni çıkartılır. Eski DOC/XLS, arşiv içeriği ve taranmış görüntülerin OCR işlemesi bu sürümde yoktur; metin okunamadığında AI başarılı rapor üretmiş gibi gösterilmez. Tarihi olmayan belgeler için önceki yayın tarihi karşılaştırması çalıştırılmaz ve raporda yayın tarihinin bilinmediği belirtilir.

## Hesaplar ve tarayıcı

Yerel Kaynaklar → Tarama profili ve hesap bölümünde hesap kaydedilip bağlantı denenebilir. AES-256-GCM şifreleme kaynak ve çalışma alanı kimliğine bağlıdır. Parola API'ye geri verilmez. Anahtar `SOURCE_CREDENTIAL_KEY` (32 bayt base64) veya `SOURCE_CREDENTIAL_KEY_FILE` ile sağlanır. Yerel servis varsayılanı `~/.config/atez/source-credentials.key`; dosya 0600, dizin 0700 olmalıdır. Veritabanı ve anahtar ayrı güvenli yedeklenmelidir. Anahtar değişirse mevcut kayıtları yeniden şifrelemek gerekir; otomatik anahtar rotasyonu yoktur.

Bu kurulum tek yerel çalışma alanıdır (`local`). Profil/hesap yönetimi yerel adresten, izin verilen origin ve değişikliklerde `X-Source-Intent: manage` başlığıyla yapılır. Uzak API için `SOURCE_ADMIN_BEARER` tanımlanabilir; çok kullanıcılı OIDC/rol ve çalışma alanı izolasyonu bu sürümün parçası değildir. Yerel korumayı uzak proxy üzerinden genel erişime açmayın.

Form oturumları bellekte yaşar, çalışma bitince kapanır; sonraki çalışmada kayıtlı hesapla yeniden giriş yapılır. MFA/CAPTCHA ve eksik abonelik müdahale gerektirir, aşılmaz. Mevzuat.Net hesabı olmadan giriş akışı uçtan uca doğrulanmış değildir. TARIFF mevcut ortam hesabıyla veya kayıtlı kaynak hesabıyla API kullanır; token önbelleği hesap başına ayrıdır.

Tarayıcı trafiği izin verilen alan adlarına ve DNS ile sabitlenmiş genel IP'lere sınırlıdır. Listeleme ve indirme boyut, sayfa ve belge sınırlarına tabidir. Yerelde Chromium kurulmalıdır: backend dizininde `npx playwright install chromium`. Dockerfile Chromium ve bağımlılıklarını kurar; Docker imajı bu yerel doğrulamada oluşturulmamıştır.

## Test güvenliği

`test/setup.ts` uygulama `.env` veritabanını devre dışı bırakır. Veritabanı testleri açıkça `TEST_DATABASE_URL` ile, adı `_test` ile biten ayrı bir veritabanında çalıştırılır. Bu değişken yoksa erişilemeyen test adresi atanır. Önce test veritabanına `prisma migrate deploy` uygulanmalıdır. Tüm kayıtları temizleyen sözleşme testleri, kayıt oluşturup temizleyen entegrasyon testleriyle aynı veritabanında eşzamanlı çalıştırılmamalıdır.
