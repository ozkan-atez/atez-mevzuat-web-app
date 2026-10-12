# Sohbet odaklı tarama ve ekip raporları uygulama planı

12 Ekim 2026 · Durum: Uygulama planı

Geri dönüş kaydı: Bu plan kapsamında sonradan uygulanan sohbet, rapor, kaynak, şablon ve kullanım yenilikleri kullanıcının isteğiyle geri alındı. Uygulama kodu `7e66125` durumuna döndü ve yerel servisler eski sürümle yeniden başlatıldı. Mevcut veriler yedeklendi ve korundu; uygulanmış eklemeli migration dosyası ile veritabanındaki ek alanlar ve tablolar geçmiş kayıtları silmemek için tutuldu. Yeni özellikler etkin değildir.

Yeni taramalar sohbetten başlatılacak. Kullanıcı sohbetin artı menüsünden kaynaklarını ve belgelerini seçecek; araştırma ve rapor üretimi bu seçimle sınırlanacak. Her rapor, kendisine bağlı sohbetleri, değişiklikleri ve sürümleri aynı çalışma alanında toplayacak. Rapor sohbetlerini rapora erişen ekip üyeleri görecek; genel sohbetler kişisel kalacak. Bu görünürlük kararı kullanıcı tarafından doğrulandı.

Bu paket mevcut uygulama ve `/Users/ozkan/Downloads/prototype/` içeriğine göre hazırlanmıştır. Uygulama kodunda değişiklik yapılmamıştır. Prototipin HTML ve JavaScript içeriği incelendi; tarayıcı yerel dosya erişimini engellediği için görsel etkileşim doğrulaması yapılmadı. Prototipteki örnek yanıtlar ve yerel durum kayıtları, gerçek servis davranışı olarak kabul edilmez.

## Sayfa bazında planlar

| Plan | Kullanıcıya görünen sonuç | Bağımlılık |
| --- | --- | --- |
| [01 Dashboard ve rapor listesi](2026-10-12-sohbet-odakli-akis/01-dashboard-ve-rapor-listesi.md) | Yeni tarama sohbeti açar; dashboard butonu kalkar; Otomasyon ve Manuel ayrılır. | Köken alanları için ortak veri sözleşmesi. |
| [02 Sohbet ve kaynak seçimi](2026-10-12-sohbet-odakli-akis/02-sohbet-ve-kaynak-secimi.md) | Artı menüsüyle kaynak, dosya, bağlantı ve arşiv seçilir; yanıt kapsamı görünürdür. | Kaynak kataloğu; yerel kaynak koleksiyonları için 04. |
| [03 Rapor sohbetleri ve revizyonlar](2026-10-12-sohbet-odakli-akis/03-rapor-sohbetleri-ve-revizyonlar.md) | Rapor altında ekip sohbetleri; belirgin AI alanı; kişi bazında geçmiş ve sürüm seçimi. | Ortak rapor kimliği ve erişim politikası. |
| [04 Kaynak kurulumu ve belgeler](2026-10-12-sohbet-odakli-akis/04-kaynak-kurulumu-ve-belgeler.md) | Adres ve hesap bilgisiyle kurulum; bağlantı testi; yerel belgeler; şablon bağlamı. | Bölüm kimlikleri için 05 sözleşmesi. |
| [05 AI ile rapor şablonları](2026-10-12-sohbet-odakli-akis/05-ai-ile-rapor-sablonlari.md) | Başlık ve açıklamalardan AI yönlendirmeli bölüm yapısı ve önizleme. | Mevcut şablon ve rapor üretim motoru. |
| [06 Kullanım ve sohbet tokenları](2026-10-12-sohbet-odakli-akis/06-kullanim-ve-sohbet-tokenlari.md) | Sohbet, rapor revizyonu ve diğer AI işlemleri ayrı kullanım kalemleridir. | Ölçüm altyapısı baştan eklenir; 02–05 ile bağlanır. |

## Mevcut uygulama ile hedef arasındaki farklar

| Alan | Mevcut durum | Gerekli değişiklik |
| --- | --- | --- |
| Tarama girişi | `StartScanAction` tarih ve tarama modalı açıyor; dashboard da kullanıyor. | Sohbete yönlendirme ve dashboard eyleminin kaldırılması. |
| Rapor türü | `ReportsIndex` içindeki Tür, içerik biçimini gösteriyor. | Üretim türü ve içerik türünün ayrılması; sunucudan güvenilir köken. |
| Sohbet kapsamı | Ekli belge sürümleri ve web araçları var; mesaj sözleşmesinde seçili kaynak kapsamı yok. | Kapsamın mesaj, araç erişimi, işlem ve yanıt kaynakçasında uygulanması. |
| Rapor geçmişi | Genel geçmiş yalnızca `ChatSession` döndürüyor; rapor düzeltme geçmişi ayrı tutuluyor. | Rapor grupları altında kalıcı sohbetler ve ortak faaliyet akışı. |
| Rapor düzenleme | Konu raporları `ReportWorkspace`, bağımsız belge raporları `StandaloneReportCorrection` yolunu kullanıyor. | Aynı rapor sohbeti ve sürüm deneyimine iki yolun da bağlanması. |
| Kaynaklar | Kaynak, ek bağlantı, profil ve belge arşivi parçaları mevcut. Worker başlangıçta ve altı saatte bir kaynak yenilemesi gönderiyor. | Tek anlaşılır kaynak kataloğu; yalnızca kurulum, test veya açık iş talebinde çalışma. |
| Şablonlar | Bölümler `id`, `heading`, `html`, `enabled` bilgilerini taşıyor. | Bölüm amacı, AI talimatı, kaynak bağlantısı ve sürümlü yapı eklenmesi. |
| Kullanım | Tarama ve analiz çağrılarının tokenları toplanıyor; sohbet sayısı var. Sohbet model akışı token ölçümü taşımıyor. | Sağlayıcı çağrısı bazında ölçüm ve sohbet bazında döküm. |

## Ortak ürün kararları

- **Manuel**, kullanıcının sohbetten veya doğrudan belge çalışmasından istediği rapordur. **Otomasyon**, kayıtlı otomasyon akışı tarafından üretilen rapordur. Otomasyonu elle çalıştırmak üretim türünü değiştirmez; başlatan kişi ayrıca tutulur. Bu sınıflama uygulama önerisidir.
- Kaynağı kaydetmek arka planda kurulum başlatabilir; rapor üretmez. Bağlantı testi sınırlı örnek içerikle çalışır. İçerik toplama ve rapor üretimi sohbet talebi veya tanımlı otomasyonla başlar.
- Şablonun kaynak önerisi, kullanıcının sohbet kapsamını kendiliğinden genişletmez. Gerekli kaynak seçilmemişse kullanıcıya eksik kaynak gösterilir.
- Raporun sabit kimliği vardır. Sohbet, taslak, yayımlanmış sürüm, işlem ve kullanım kaydı bu kimliğe bağlanır. Raporun yeni sürümü yeni rapor grubu açmaz.
- Bir sürümü görüntülemek, o sürümü güncel yapmaz. Eski sürümden devam etmek yeni taslak oluşturur; seçili değişiklikleri kaydetmek yeni sürüm üretir.
- Rapor kökeni ile düzenleme yöntemi ayrıdır: otomasyon raporuna yapılan manuel veya AI düzeltme raporu Manuel olarak yeniden etiketlemez.
- Genel sohbetler kişisel kalır. Rapora erişim, o raporun sohbetini görme hakkını belirler; düzenleme ve yayımlama ayrıca rol iznine bağlıdır. E-posta dağıtım grubu uygulama erişim grubu olarak kullanılmaz.

## Uygulama sırası

1. **Ortak sözleşmeler:** Rapor kimliği ve kökeni, sohbet kaynak kapsamı, bölüm kimlikleri, aktör kaydı, kullanım olayı ve erişim kuralları netleştirilir. Yeni alanlar mevcut kayıtlara uyumlu eklenir.
2. **İlk arayüz teslimi:** 01 ve 03 içindeki AI alanının görsel düzeni uygulanır. Sohbet açmak taramayı otomatik çalıştırmaz. Kalıcı rapor sohbeti henüz hazır değilse tamamlanmış gibi sunulmaz.
3. **Sohbetten tarama:** 02, mevcut kayıtlı kaynaklar ve belge arşivi üzerinde uçtan uca tamamlanır. Kullanım ölçümü aynı teslimle çalışır.
4. **Şablon ve kaynak kurulumu:** Önce 05 bölüm sözleşmesi, ardından 04 kaynak ve bölüm eşleştirmeleri tamamlanır; sonra iki arayüz bağlanır. Sürekli kaynak yenileme kaldırılırken kayıtlı otomasyonların gerekli veriyi kendi çalışmaları içinde alması doğrulanır.
5. **Ekip revizyonları:** 03 kalıcı sohbetler, kişi bilgileri, sürüm karşılaştırma, seçili değişiklikleri alma ve eşzamanlı düzenleme kontrolüyle tamamlanır.
6. **Kullanım ekranı ve bütünleşik kontrol:** 06 arayüzü tamamlanır. Tüm akışlar masaüstü ve dar ekranda gerçek servislerle doğrulanır.

İşler ayrı geliştirme paketleri olarak takip edilebilir. Şema, aktör ve erişim değişiklikleri ortak temel olarak tekleştirilmelidir; her sayfa kendi rapor veya kaynak modelini üretmemelidir. Süre tahmini ekip kapasitesi ve AI kurulum denemeleri görülmeden kesinleştirilmemiştir.

## Geçiş ve tamamlanma ölçütleri

Eski rapor bağlantıları ve belge sürümleri korunur. Yeni alanların geçmişe doldurulması önce raporlanan bir deneme ile yapılır. Kanıtı olmayan rapor kökeni veya değişiklik sahibi tahmin edilmez; eski kayıt olarak gösterilir. Tarihler kullanıcıya Europe/Istanbul saat diliminde sunulur.

Veritabanı testleri izole test veritabanında çalıştırılır. Canlı kaynak kurulumu ve AI tüketimi ayrı, kontrollü entegrasyon doğrulamasıdır. Kabul koşulları:

1. Yeni tarama girişi sohbeti açar; dashboardda ayrı tarama başlat butonu bulunmaz.
2. Kaynak A seçildiğinde B kaynağına erişilmez; sohbet geçmişi ve otomatik yardımcı adımlar da kapsamı genişletmez.
3. Rapor kaynakları, şablon sürümü ve üretim türü sonradan açıklanabilir.
4. Aynı rapora erişen iki ekip üyesi birbirinin rapor sohbetlerini ve değişikliklerini görür; erişimi olmayan üçüncü kişi göremez.
5. Eski sürüm seçimi geçmişi bozmaz; eşzamanlı düzenleme bir kullanıcının değişikliğini sessizce ezmez.
6. Kaynak kaydı tekrar eden tarama oluşturmaz; bağlantı testi rapor üretmez.
7. Bölüm açıklamaları raporun gerçek üretimine yansır; eksik bilgi uydurulmaz.
8. Kullanım toplamları tekil çağrı kayıtlarıyla mutabıktır; sağlayıcının bildirmediği tüketim sıfır olarak gösterilmez.

## İncelenen başlıca referanslar

- Prototip: `assets/ai-workspace.js`, `notebook-workspace-model.js`, `report-source-model.js`, `report-source-workspace.js`, `source-context.js`, `template-review-model.js`, `report-experience.js`, `report-workflow-model.js`.
- Uygulama: `frontend/src/features/chat`, `reports`, `revision`, `workspace`, `scans`; `backend/src/modules/chat`, `managed-sources`, `workspace`, `operations`; `backend/prisma/schema.prisma` ve `backend/src/worker.ts`.
- Önceki temel: [Modüler işlemler ve belge ekleme](2026-10-11-moduler-islemler-ve-belge-ekleme.md). Bu plan o altyapının üzerine kullanıcı deneyimini ve ekip işbirliğini ekler.
