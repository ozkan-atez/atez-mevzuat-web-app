# Sohbetten HTML raporu

Genel sohbette açık bir “rapor oluştur / hazırla / raporlaştır / raporlara ekle” isteği, sohbet modelinin araç seçimine bırakılmadan rapor akışına girer. Şablon seçmek veya rapor oluşturmanın nasıl yapıldığını sormak tek başına rapor üretmez. Mevcut genel tarama komutları tarama akışını korur.

## Kaynak ve şablon

- Mesajda seçilmiş kaynaklar mevcut kaynak tarayıcısından, belge sürümleri erişim kontrollü arşivden okunur.
- Doğrudan HTTPS bağlantıları mevcut DNS ve boyut sınırlı kaynak okuyucusundan okunur.
- Kaynak seçili normal sohbet yanıtında kaynak metni ve kapsam uyarıları mesajın `context` alanında saklanır. Takip raporu bu kanıtı kullanır.
- Yeni açık kaynak/belge seçimi eski kanıtlarla karıştırılmaz.
- Eski sohbetlerde kaynak metni saklanmamışsa son asistan yanıtındaki kaynak bağlantıları yalnız keşif ipucu sayılır ve yeniden okunur. Asistanın yazdığı özet kanıt değildir.
- Seçilen şablon, önceki kullanıcı mesajındaki şablon veya ilk etkin şablon kullanılır. Mevcut HTML bölüm şablonları ve yeni tanım şablonları aynı BUILD_REPORT üreticisini kullanır. Üretimde şablonun sürümü dondurulur.

## Kayıt

Kaynak dayanaklı ANALYSIS çıktısı, HTML REPORT_DRAFT ve yayımlanmış rapor sürümü mevcut işlem/rapor kayıtlarında saklanır. Kaynak alıntısı ve şema doğrulaması başarısızsa bir düzeltme denemesi yapılır; yine başarısızsa rapor kaydedilmez. Rapor oluşturma/kaydetme yetkileri ayrıca kontrol edilir. E-posta gönderilmez.

Sohbet mesajı önce kalıcı işin kaydedildiğini bildirir. İşlem kartı yalnız başarılı yayımlamadan sonra `/reports/documents/:id` bağlantısını gösterir; rapor Raporlar listesinde görünür. Mesaj kimliği tekrarı aynı iş planına döner; yayımlama mevcut taslak/sürüm kilidiyle tekilleştirilir. Başarısız işlem yeniden denenebilir; geçmiş hata kayıtları genel sohbet yanıtında başarı gibi gösterilmez.

## Sınırlar

Web araması ve tarayıcı araştırması modları ayrı araştırma akışlarıdır; rapor için normal sohbet akışında kaynak bağlantısı veya araştırma sonucundaki bağlantı kullanılmalıdır. Henüz metni çıkarılmamış yüklemeler rapor üretmeden önce metin çıkarma gerektirir. Doğrudan sayfa okuması bağlı eklerin tamamını taramaz; kapsam uyarısı verilir. Kaynak tarayıcısının kayıt ve metin sınırları raporda tam kapsam iddiasına dönüşmez.

## Ortak rapor ve revizyon akışı

Sohbet ve bağımsız kaynak işlemlerinin BUILD_REPORT çıktısı artık ortak ReportSpec sözleşmesini ve renderReportHtml üreticisini kullanır. Aynı şablon tanımı ve dondurulmuş şablon sürümü korunur. Eski REPORT_DRAFT kayıtları okunurken ortak sözleşmeye uyarlanır; yayımlanmış nesneler değiştirilmez. Eski dosya adları yeni revizyon kaydında standart HTML adına dönüştürülür.

Raporlar ve sohbet içindeki rapor bağlantıları aynı ReportWorkspace ekranını, taslak alan düzenlemelerini, sürüm geçmişini ve publishReportDraft kaydetme yolunu kullanır. Kaynak raporuna sahte Resmî Gazete konusu veya tarama kaydı oluşturulmaz.

Rapor sohbetindeki talepler ayrıdır:
- “Analizi paylaş/göster”: kayıtlı analizi okur; model çağrısı veya rapor değişikliği yapmaz.
- “Analizi tekrar yap/yenile”: kaynak kanıtlarından yeni analiz sürümü üretir; açık taslağı ve yayımlanmış raporu değiştirmez.
- “Yeni analizi rapora uygula” veya metin düzeltmesi: kayıtlı analiz bağlamıyla ortak alan düzenleme akışını kullanır; değişiklikler Kaydet ile yeni sürüm olur.

Modelin NEEDS_ANALYSIS kararı kendiliğinden yeniden analiz başlatmaz. Sohbette gerekçe açıklanır; yeni analiz kullanıcının açık talebini bekler. Kaynak analizinin ilk üretimi, bağımsız ANALYZE ve yeniden analiz aynı analyzeSourceEvidence doğrulayıcısını kullanır.

## Çoklu rapor ve kalıcı yürütme (14 Ekim 2026)

Sohbet kaynakları önce `planChatReports` ile ana belge / ek / önceki düzenleme / yardımcı kaynak olarak gruplar. Açık rapor sayısı, kaynak kimlikleri, kapsam tekrarları ve tüm kaynakların kapsanması doğrulanır. Aynı belgedeki bağımsız konular ayrı gruplarda ele alınabilir; karşılaştırma talebinde eski ve yeni belge tek gruptadır.

İş planı, kaynak metinleri ve şablon sürümü tek veritabanı işlemiyle saklanır. Her grup için `ANALYZE → BUILD_REPORT → PUBLISH_REPORT` bağımlılıkları ve kalıcı outbox kayıtları oluşturulur. `PUBLISH_REPORT` yalnız sunucunun ürettiği görev parametrelerinde geçerlidir; genel işlem API'sinden doğrudan çağrılamaz. Worker her aşamada ilgili kullanıcı yetkisini doğrular. Bağlantının kapanması kayıtlı işi iptal etmez; görev iptali ayrıca yapılır. İşleyen worker ve `MODULAR_OPERATIONS_ENABLED=true` gereklidir.

Sohbet ilk yanıtında işi kaydettiğini söyler; henüz yayımlanmamış rapor için başarı veya rapor bağlantısı üretmez. İşlem kartı ilerlemeyi ve tamamlanan her raporun kalıcı bağlantısını gösterir. Her gruptaki hata bağımsızdır. Başarısız adımın yeniden denenmesi bağımlılık nedeniyle engellenen sonraki adımları açar. Yayımlama taslak kimliğine göre tekilleşir; tamamlanmış rapor yeniden üretilmez.

Otomasyonun konu raporları ile kaynak/sohbet raporları `produceReportDocument` üzerinden şablon uygulama, HTML oluşturma ve doğrulama yapar. Kaynağa özgü analiz sözleşmeleri korunur; yüklenen belgeye resmîlik veya Resmî Gazete kimliği atanmaz. URL'siz yüklemelerde kaynak bağlantısı uydurulmaz.

İşlem kartındaki eski analiz/rapor düzenleme pencereleri kaldırılmıştır. Rapor bağlantısı ortak ReportWorkspace ekranını açar. AI içerik revizyonları şablon tanımını, bölüm sırasını, bileşenleri, kaynakları ve HTML yapısını değiştiremez. Tasarım değişiklikleri Şablonlar ekranında yapılır. Eski `REVISE_REPORT` yolu yapılandırılmış şablonları yeniden üretmez; kullanıcıyı ortak düzenleme ekranına yönlendirir. Basit eski raporlarda alan yaması uygulanır.

Doğrulama: ayrı test veritabanında iki bağımsız rapor, bir grubun başarısızlığı ve yeniden denenmesi, iki kalıcı yayın, tekrar çağrıda kopya oluşmaması, kaynakların karışmaması ve metin düzeltmesinde tasarımın korunması sınanır.
