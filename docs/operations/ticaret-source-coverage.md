# Ticaret Bakanlığı günlük tarama kapsamı

14 Ekim 2026 tarihinde canlı HTML yapıları incelenerek yerleşik profil sekiz listeye genişletildi:

- Gümrükler Genel Müdürlüğü duyuruları
- Gümrük genelgeleri (hedef yıl)
- Bakanlık haberleri
- Bakanlık duyuruları
- Kurumsal haberler
- Ekonomi haberleri
- Ürün güvenliği duyuruları
- İthalat Genel Müdürlüğü duyuruları

Toplama sırasında gümrük anahtar kelimesi şartı aranmaz. Günlük seçim yayın tarihine göre yapılır; içerik uygunluğu mevcut belge filtreleme aşamasında değerlendirilir. Liste adresi her kayıtta `feedUrl` olarak tutulur. Aynı bağlantı farklı listelerde bulunsa da bir kez kaydedilir.

Haber başlıkları `h5`, yayın tarihleri listenin `.text > span` alanından okunur. Tarih listede yoksa `.__header span` ayrıntı alanına bakılır. Başlıktaki etkinlik tarihleri yayın tarihi sayılmaz. Tarihsiz kayıtlar envanterde kalır; günlük seçime girmez.

Bakanlığın `s` parametreli sonraki sayfa bağlantısı izlenir. Tamamı tarihli ve hedef günden eski olan sayfadan sonra durulur. Kısmen tarihsiz bir sayfa bu durdurma koşulunu sağlamaz. Liste başına en fazla 10 sayfa ve toplam 300 benzersiz kayıt okunur. Sınıra ulaşılması veya erişim hatası kapsam uyarısı üretir; bu sonuç eksiksiz tarama olarak sunulmaz.

Önceki iki listeli yerleşik profil değişmeden kullanılıyorsa, sonraki yeni taramada yeni bir profil sürümü oluşturulur. Özel ayarları değiştirilmiş profiller otomatik değiştirilmez. Başlamış çalışmaların profil anlık görüntüleri korunur.

Bu kapsam tüm sitenin sınırsız taranması veya tüm sayfalardaki metin değişikliklerinin tespiti değildir. `PUBLISHED_DATE` seçimi günlük yayınları toplar; mevcut `NEW_OR_CHANGED` modu bulunan belgelerin içerik değişimini izlemek için ayrıca kullanılabilir. 14 Ekim incelemesinde Ülkelerden Ticari Haberler ve İhracat Genel Müdürlüğü duyuru adresleri HTTP 200 içinde “Internal Server Error” sayfası döndürdüğünden profile eklenmedi.

Doğrulama: `backend/test/unit/ticaret-multi-feed.test.ts` sayfalama, geniş konu kapsamı, tarih alanı, ortak kayıt bütçesi, tekrarlanan bağlantılar, eksik tarih, bölüm erişim hatası ve eski profil yükseltmesini kapsar.

## Sohbet yolu düzeltmesi — 14.10.2026

İlk kaydedilmiş iki listeli profil, sonradan eklenen `titleSelector` ve ortak referans alan adlarını içermediğinden eski sürüm eşleştirmesinden kaçıyordu. Yükseltme artık yayımlanmış iki eski biçimi de tanır; kullanıcıya özel limit, liste ve erişim kurallarını değiştirmez. Sohbetin profilden bağımsız 30 belge / 2 sayfa kesintisi kaldırıldı; doğrulanmış profil sınırları ve alan adı kısıtlaması korunur.

Sohbet kanıtı `targetDate`, `inspectedPages`, `matchedItems` ve tarih belirsizliği notlarını içerir. İçeriği okunamayan listelenmiş kayıt ile gerçekten boş eşleşme ayrılır. Belge bütçesi nedeniyle hiç okunmayan listeye artık yapı/tarih doğrulanamadı hatası yazılmaz; erişilemeyen kapsam açıkça belirtilir.

Kullanıcının 13 Ekim sorgusuyla gerçek sohbet tarayıcısı doğrulandı: 8 bölüm, 11 liste sayfası, 4 eşleşme ve 4 okunabilir belge; kapsam uyarısı yok. Tarihi bilinmeyen 15 envanter kaydı günlük eşleşmeye alınmadı. Kanıt `.local/ticaret-chat-2026-10-13.json` dosyasındadır. Bu kontrol haber/duyuru keşfini doğrular, kayıtların mevzuat değişikliği olduğu sonucunu vermez.
