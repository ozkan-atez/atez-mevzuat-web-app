# Rapor şablonları — içerik ve tasarım düzenleyicisi

Yeni şablonlar `ReportTemplate.definition` içinde sürüm 2 sözleşmesiyle saklanır. `requirements` AI içerik talimatlarını; `components` yeniden kullanılabilir görsel parçaları; `layout` içerik bağlantılarını ve yerleşimi; `theme` ve `shell` görünümü tanımlar. Açıklamalar rapora yazdırılmaz. HTML her önizleme ve raporda aynı renderer üzerinden mevcut ATEZ iskeletinden üretilir.

## Kullanım

Şablonlar → Şablon oluştur. Kullanıcı adını ve “Rapordan ne bekleniyor?” açıklamasını yazar. Açıklama `definition.brief` içinde rapor üretiminin asıl talimatı olarak saklanır; görünür rapora kopyalanmaz. Örnek başlangıç açıklaması düzenlenebilir. İçerik/tasarım/deneme sekmeleri ve elle bileşen ekleme kaldırılmıştır.

Bileşen havuzu gerçek rapor renderer’ından üretilen izole HTML önizleme kartları gösterir. Kartlar büyük önizlemede incelenebilir. HTML, scriptsiz sandbox iframe ve içerik güvenlik politikasıyla görüntülenir.

Bileşen havuzuna yalnız “Bileşen asistanı” sohbeti üzerinden öneri oluşturulur. Takip mesajları önceki öneriyi geliştirebilir; son 12 mesaj modele bağlam olarak iletilir. Sohbet düzenleyici oturumu boyunca tutulur. Öneri önizlenip havuza eklenir, ardından şablon kaydedilir. Bileşen açıklaması hangi analizlerde kullanılacağını belirtir. Yeni bileşen eklemek onu rapora zorunlu yerleştirmez. İstek sırasında açıklama veya havuz değişirse eski öneri uygulanamaz. Geri al/ileri al ve sürüm çakışması koruması devam eder.

Rapor AI'ı `brief` varsa aynı model çağrısında açıklamaya uygun bölümleri ve kaynaklı içeriklerini üretir; analizdeki verilere göre havuzdan bileşen seçer. Bölümler için otomatik yerleşim oluşturulur ve raporda dondurulur. Havuz ve kurumsal görünüm değişmez. `brief` bulunmayan mevcut tanımlar eski gereksinim/yerleşim sözleşmesiyle çalışır; düzenleyicide kaydedilince açıklama tabanlı üretime geçer. Eski HTML şablonları korunur, yeni düzende ayrı kopya oluşturulabilir.

Yeni bileşenler desteklenen temel parçaların bileşimidir; çalıştırılabilir HTML/JavaScript değildir. Önizleme örnek içerikle yalnız görünümü gösterir; gerçek rapor üretimi yapmaz. Eski CONTENT/DESIGN/TRIAL API kipleri uyumluluk amacıyla korunur ancak sade ekranda sunulmaz.

## Sözleşmeler

- `POST /api/v1/templates/preview`: definition ve title → örnek içerikle güvenli HTML; isteğe bağlı componentIds → bileşen kimliğine göre izole HTML haritası; model çağrısı yapmaz.
- `POST /api/v1/templates/ai`: requestKey (UUID), definition, mode (`CONTENT`, `DESIGN`, `COMPONENT`, `TRIAL`), instruction; denemede sourceText veya documentVersionIds. Kalıcı TemplateAiRequest kaydı, aktör kapsamına bağlı tekrar koruması ve sağlayıcı kullanım bilgisi tutulur.
- Şablon güncellemesi `expectedRevision` gerektirir. Atomik sürüm karşılaştırması başarılı olursa revision artırılır; çakışmada 409 döner.
- Yeni şablonlar için definition otoritatiftir. Eski html/sections alanları uyumluluk için tutulur; yeni renderer bu eski örnek metinlerden içerik üretmez.
- Otomasyon ve modüler rapor işlerinin başlangıcında definition ve revision dondurulur. Üretimde yalnız dondurulan tanım kullanılır.
- Raporun content alanı, şablon sürümü, kaynak referansları ve seçilen bileşenlerle birlikte saklanır. Yeni şablon değişiklikleri eski raporu değiştirmez.

## Üretim ve eksik bilgi

Şablon üretimi kaynaklı analiz sonucunu ve kanıtlarını kullanır. Her etkin bölüm tekil olmalıdır; kaynak kimlikleri mevcut kanıtlara çözülmelidir. READY içerik için seçilen bileşen alanları doldurulmalıdır. Eksik bilgi NOTE, OMIT veya BLOCK kuralına göre ele alınır; zorunlu bölüm OMIT olamaz. BLOCK gerçek üretimi durdurur; denemede inceleme uyarısı olarak gösterilir. NOT_APPLICABLE, MISSING'den ayrıdır.

Rapor genelinde kapsam, üretilen raporun tüm kanıt setini kapsar. Eski tarama akışında her mevzuat ayrı rapordur; bu akışta run genelinde birleşik yönetici özeti oluşturulmaz. Modüler akışta seçili birden fazla belge aynı raporun bağlamını oluşturabilir.

Yayımlanan şablon raporlarının görünür metinleri `customization.templateReport.content.sections.#.fields.#` yollarıyla düzeltilebilir. Analiz yeniden üretildiğinde dondurulmuş içerik gereksinimleri yeni analize yeniden uygulanır. Şablon sayfasındaki AI tasarım talebi içerik talimatlarını değiştiremez.

## Dağıtım ve doğrulama

Migration: `20261013143000_template_definition`. Prisma istemcisi yeniden üretilmeli; API ve worker yeni kodla başlatılmalıdır. Gemini sağlayıcısı mevcut `revisionModel` ve worker AI istemcisi üzerinden kullanılır. Sağlayıcı yapılandırması/erişimi yoksa elle düzenleme ve örnek önizleme çalışmaya devam eder.

Kapsamlı testler izole `_test` veritabanıyla çalıştırılmalıdır. Gerçek AI bağlantısını, yalnız kurgu metin göndererek kontrol etmek için backend dizininde `npm exec tsx scripts/verify-template-studio.ts` kullanılabilir; bu işlem sağlayıcı kullanımına tabidir ve kaydetme/yayımlama yapmaz.
