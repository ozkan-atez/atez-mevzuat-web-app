# Tarihli kaynak taramaları

Resmî Gazete taraması mevcut belge, analiz ve bülten hattını kullanır. Diğer kaynaklar ayrı `SourceScanRun` kayıtları üretir; tarihli bağlantılar, okunabilen metin ve kaynak bağlantılı HTML raporu bu kayıtta tutulur. Destekleyici veya ticari kaynaklar resmî belge statüsü kazanmaz.

Etkin tarih akışları:

| Kaynak | Akış | Uyarlayıcı |
| --- | --- | --- |
| Ticaret Bakanlığı | `https://ggm.ticaret.gov.tr/duyurular` | Ayrıntı sayfalarının yayımlanma tarihi |
| Ticaret Bakanlığı | `https://ticaret.gov.tr/gumruk-islemleri/mevzuat/genelge/2026` | Yıl bazlı genelge listesi ve PDF |
| İGMD | `https://www.igmd.org.tr/mevzuat_haberleri` | Tarihli mevzuat haberleri |
| Mevzuat.Net | `https://www.mevzuat.net/Guncellik.aspx` | Güncellik listesi (son kayıtlarla sınırlı) |
| TARIFF | `https://tariff.singlewindow.io/legislation-news` | Keycloak kullanıcı adı/şifresiyle alınan erişim belirteci |

İGMD, GGM ve Mevzuat.Net'in görünen liste penceresi dışında kalan eski tarihler doğrulanmış boş gün olarak işaretlenmez. TARIFF için `TARIFF_USERNAME` ve `TARIFF_PASSWORD` yerel `.env` dosyasında tutulur. Şifre geçerli olduğunda `TARIFF_ENABLED=true` ayarlanıp API ve worker yeniden başlatılır; bu işaret kapalıyken seçim ve otomatik iş oluşturma devre dışıdır. Belirteç bellekte tutulur ve süresi dolduğunda yenilenir. Kaynak taramaları İstanbul saatine göre 06:30, 11:30, 16:30 ve 23:30'da her etkin kaynak için ayrı, tekrar edilmeyen iş olarak zamanlanır. Başarısız ve kısmi işler aynı kimlikle yeniden denenebilir. Kullanıcı tarama başlatma penceresinden tek kaynak ve tarih seçer; kaynak taramaları Kaynaklar sayfasında listelenir.

`GET /api/v1/source-runs/:id/report?download=1` indirilebilir HTML verir. Bu kaynak dökümü, Resmî Gazete için üretilen analizli ATEZ bülteninin yerini almaz.
