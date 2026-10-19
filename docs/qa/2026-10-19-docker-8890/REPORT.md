# Docker 8890 sohbet ve araç test raporu

Tarih: 19 Ekim 2026, Europe/Istanbul. Hedef: http://localhost:8890.

## Kapsam ve yöntem

Canlı tarayıcı testleri Docker admin oturumunda, yalnız bu test için açılan **QA-8890 Kayıtlı İşlem ve Otomasyonlar** sohbetinde yapıldı:
http://localhost:8890/chat/907bf3ba-dc32-4340-ae41-48abcb8747f3

Çalışan yığının kaynak klasörü `/Users/ozkan/Documents/GitHub/atez-mevzuat-web-app/.claude/worktrees/dev-2`, kontrol edilen HEAD `d94ef4d`. Başlangıç çalışma klasörü farklı olduğundan oradaki eski test sonuçları bu rapora katılmadı. Docker ile dev-2 `chat-tools.ts` SHA-256 eşleşti: `ab20f880b22cce7c92d992d9e2fd008dc45aa7a43c52ad7078684865651c1e13`.

- Dev-2 backend sohbet testleri: **12 dosya / 92 test geçti**.
- Dev-2 frontend sohbet testleri: **9 dosya / 51 test geçti**.
- Çalışan Docker kodundaki **23 aracın tamamı**, kontrollü servis taklitleriyle doğrudan çağrıldı: 23/23 yönlendirme geçti.
- Bağımsız işlemin 8 türü de kontrollü servis taklitleriyle çağrıldı.
- Geçersiz tarih, geçersiz GTİP, seçimsiz belge işlemi ve bilinmeyen araç reddedildi.

Bu sayılar tüm araçların gerçek dış servislerle uçtan uca başarılı olduğu anlamına gelmez. Canlı senaryolar ve kontrollü testler aşağıda ayrıdır. Entegrasyon testleri uygulama veritabanında çalıştırılmadı. Uygulama kodu değiştirilmedi; gerçek e-posta gönderilmedi, rapor yayımlanmadı ve bileşen havuzuna kayıt yapılmadı.

## Bulgular

### P1 — Oturum çok kısa sürede kayboluyor (canlı gözlem; neden henüz belirlenmedi)

1. Kullanıcı giriş yaptı; Dashboard açıldı.
2. Sohbetler menüsüne tıklanınca “Oturumunuz sona erdi” gösterildi.
3. Yeniden giriş bağlantısı mevcut sağlayıcı oturumuyla sohbeti açtı.
4. İlk mesajdan sonra aynı ekran tekrar görüldü. Başka bir yanıt tamamlandıktan sonra da `/api/v1/chat/sessions` 401 döndü.

Beklenen: Geçerli oturumda sayfa ve sohbet geçişinin kesilmemesi. Sonuç: Kullanıcı tekrar giriş akışına dönüyor. Okunan yeni oturum kayıtlarında `revoked=false` olması kök nedenin tek başına süre aşımı olarak açıklanamayacağını gösteriyor. Test anında birden fazla yerel yığın vardı; çerez, diğer istemciler ve oturum yenileme etkileşimi ayrıca izlenmeli. Nedeni kesinleştirilmeden çerez çakışması denmemeli.

Kanıt: `session-expired.png`; backend `req-49` ve `req-5v` için 401 gözlemi.

### P1 — “Tarama başlatma” denmesine rağmen araç katmanı başlatıcıyı çağırabiliyor (kontrollü test)

`runChatTool('tarama_baslat', {tarih:'2026-10-19'}, ..., {userContent:'Tarama başlatma, sadece kayıtları oku', scanStarter: mock}, 'negation')` çağrısında taklit başlatıcı çalıştı.

Gerçek tarama açılmadı. Bulgu modelin bu aracı seçmesi halinde sunucu tarafındaki son korumanın eksik olduğunu gösterir; canlı modelin olumsuz talimatta tarama açtığı iddia edilmez. `chat-tools.ts` içindeki bu dal tarih ve servis varlığını kontrol ediyor, kullanıcının olumlu/olumsuz niyetini kontrol etmiyor. Bağımsız işlem dalında ayrıca niyet kontrolü var.

### P1 — Arşivden seçilen okunabilir HTML belge EXTRACT işleminde başarısız (canlı)

1. “Arşiv belgelerinde kablosuz şarj ara ... Toplanan belgelerde ... metnini getir” mesajı gönderildi.
2. Aynı Resmî Gazete belgesi arşivde PENDING, toplanan belge yolunda okunabilir olarak döndü; içerik özeti gösterildi.
3. `+` → arşivde `kablosuz` → belgeyi seç → “Seçili belgeyi oku”.
4. EXTRACT kuyruğa alındı, kısa süre sonra FAILED oldu: “Belgeden okunabilir metin çıkarılamadı.”

İşlem: `86d46fc9-64ee-4196-9553-32aac887146f`.
Sürüm: `7540ff89-5480-4541-9025-972eff9cf912`.
Toplanan belge: `f91b344e-35da-4653-89b6-687d6cccfac3`.
Kaynak: https://www.resmigazete.gov.tr/eskiler/2026/10/20261016-14.htm

Veritabanında MIME `text/html`, özgün nesne mevcut, extractionStatus FAILED; metadata hatası “Belge okunamadı; bozuk veya şifreli olabilir.” Hata nedeni henüz kesin değil; HTML karakter kodlaması/özgün bayt çözümlemesi araştırılmalı. Hata kartının görünmesi ve yeniden deneme seçeneği doğru çalıştı.

### P2 — Çoklu niyet ve istenen sonuç sayısı kayboluyor (iki canlı örnek)

**Örnek A:** “Kayıtlı işlem kaynaklarını, otomasyonları, son 3 taramayı ve dağıtım gruplarını ayrı başlıklarla listele. Yalnız mevcut kayıtları oku; yeni işlem başlatma.”

Sonuç: yalnız **10 tarama** gösterildi; kaynaklar, otomasyonlar ve gruplar atlandı. Tarama satırlarında tarih/başlık da yok; tekrarlanan “Taramayı incele” bağlantılarını ayırt etmek güç.

**Örnek B:** “Otomasyonları listele. Ardından 00000000-0000-4000-8000-000000000000 kimlikli işlemin durumunu getir.”

Sonuç: yalnız otomasyon yanıtı. İşlem durumu ayrı mesajda sorulunca düzgün “bulunamadı” yanıtı geldi.

Kod dayanağı: `send-chat-message.ts:270` hazır sorgu cevabını erken kullanıyor. `report-query.ts` tarama sınırını 10 olarak sabitliyor; çoklu niyetin kalanını işleyecek bir tamamlama adımı yok. Tekli sorguda yararlı olan hızlı yol, birleşik istekleri eksik cevaplıyor.

### P2 — Kibar indirme talimatı reddediliyor (kontrollü test)

“Bu belgeyi indirebilir misin?” içeriği ile CAPTURE çağrısı “Kullanıcı bu işlem için açık talimat vermedi” hatası verdi. “Belgeyi indir” geçti. Türkçe istek biçimlerinin dar düzenli ifadeyle ele alınması doğal kullanımda gereksiz ret yaratıyor.

### P2 — Servis yokluğu ile gerçek boş sonuç ayrılmıyor (kontrollü test)

`otomasyonlari_listele` aracı, `listAutomations` servisi olmayan bilgi nesnesinde `{"otomasyonlar":[]}` döndürdü. Benzer opsiyonel servis kalıbı bazı arşiv/kaynak araçlarında da var. Kullanıcıya “kayıt yok” denmesi ile “servis kullanılamıyor” ayrılmalı. Gerçek Docker servisinin eksik olduğu iddia edilmez.

### P2 — Kaynak katalogları kullanıcı açısından çelişkili görünüyor (canlı)

İşlem kaynakları 6 kayıt gösterdi. `+` menüsü aynı 6 kaynağı seçilebilir sundu. “Sohbet için eklenen kaynaklarda gümrük ara” sorgusu ise sohbete açık kaynak bulunmadığını söyledi. Farklı kataloglar kullanılıyor olabilir; arayüz/yanıt bu ayrımı açıklamıyor. Kullanıcı “Kaynaklar var ama asistan yok diyor” sonucuna varabilir.

### P3 — Numaralı listeler yeniden 1'den başlıyor; Markdown ayraçları ham görünüyor

Bileşen listesindeki açıklama paragrafları her maddeyi ayrı listeye bölüyor ve tüm maddeler `1.` olarak görünüyor. `---` ayraçları çizgi yerine metin. `renderMarkdown.tsx` boş satırda listeyi kapatıyor ve numaralı listenin başlangıç değerini korumuyor.

### P3 — Teknik ayrıntılar kullanıcı yanıtına sızıyor

Kaynaklarda uzun UUID'ler ve OFFICIAL/COMMERCIAL/REFERENCE kodları, işlem yanıtında QUEUED, Tariff geçerlilik tarihinde `4000-01-01` görünüyor. Sonuncusu “açık uçlu” diye açıklansa da kullanıcıya yalnız “bitiş tarihi belirtilmemiş” gösterilmesi daha anlaşılır olur.

## Canlı olarak doğru ilerleyenler

- Giriş yönlendirmesi ve yeniden giriş sonrası sohbetin/yanıtların geri gelmesi.
- Boş mesajda Gönder düğmesinin kapalı olması; yazınca etkinleşmesi.
- Sohbet oluşturma ve otomatik başlık üretimi.
- Yanıt sırasında ilerleme metni ve durdurma düğmesinin görünmesi.
- İşlem kaynakları ve bileşen havuzunun listelenmesi.
- Dağıtım grubu/gönderim kaydı yokken boş sonuçların açık söylenmesi; e-posta gönderilmemesi.
- Arşiv ve toplanan belge araması; toplanan belgenin metninden yanıt oluşturulması.
- Raporun 2. sürümünün ve analizinin okunması; önceki kaynak yokluğunun bildirilmesi.
- Tariff sorgusu: tarih ve birimle cevap döndü. Bu test hukuki doğruluk teyidi değildir.
- Otomasyonların listelenmesi ve bulunamayan işlem için anlaşılır yanıt.
- Arşivde arama, belgeyi seçme, seçiliyken kaynak seçiminin kapanması, işlem kartının durum güncellemesi.
- Yeni bileşen taslağı üretimi: QA Test Kartı, doğrulandı durumu, HTML önizleme, ayrı pasif/aktif kaydetme düğmeleri. Havuza kaydedilmedi.

## Araç kapsamı

Tüm satırlar Docker kodunda kontrollü çağrı testinden geçti. “Canlı” gerçek sohbet çıktısı gözlemidir; kalıcı araç çağrı izi tutulmadığı için yalnız yanıt metnine dayanarak her dahili çağrı kesinleştirilmez.

| Araç | Canlı kapsam |
|---|---|
| bilesenleri_listele | Havuz listesi geldi |
| bilesen_olustur | Doğrulanmış taslak/önizleme geldi |
| bilesen_degistir | Aşağıdaki son durum notuna bakınız |
| bagimsiz_islem_baslat | 8 işlem türü kontrollü test; gerçek tüm işlem zincirleri çalıştırılmadı |
| islem_kaynaklari_listele | 6 kayıt geldi |
| islem_durumu_getir | Geçersiz kimlikte bulunamadı |
| belge_islemi_baslat | Seçili belge EXTRACT kaydedildi, işçi FAILED döndürdü |
| otomasyonlari_listele | Kayıtlı otomasyon geldi; çoklu istek eksik işlendi |
| arsiv_belgelerini_ara | Belge bulundu |
| arsiv_belge_surumu_getir | Metin PENDING olarak bildirildi |
| eklenen_kaynaklari_ara | Boş sonuç |
| eklenen_kaynagi_getir | Gerçek uygun kayıt yok; kontrollü çağrı |
| gtip_tariff_sorgula | Tarihli sorgu yanıtı geldi |
| tarama_baslat | Kontrollü başlatıcı ve tarih doğrulaması; gerçek tarama açılmadı |
| raporlari_ara | Kontrollü çağrı; canlı ayrı arama kapsamı son durum notunda |
| rapor_getir | Rapor v2 yanıtı |
| analiz_getir | Analiz yanıtı |
| belgeleri_ara | Belge bulundu |
| belge_metni_getir | Metin özeti geldi |
| taramalari_listele | Canlı hazır yanıt yolu 10 kayıt döndürdü |
| onceki_kaynaklari_listele | Kayıt yok yanıtı |
| gonderimleri_listele | Boş sonuç |
| dagitim_gruplarini_listele | Boş sonuç |

## Kanıtlar ve sınırlar

`backend-tests.log`, `frontend-tests.log`, `tools-audit.mjs`, `tools-audit.log`, `extract-operation.json`, ekran görüntüleri ve test sohbeti bu klasördedir. `tools-audit.mjs` Docker içindeki `/app` koduna göre çalışır; servisleri taklit eder, veritabanına iş yazmaz.

Canlı testte bir sohbet, mesajlar, bileşen taslakları ve yukarıdaki EXTRACT işlemi oluştu. Test kayıtları inceleme için bırakıldı. Silme, rol/izin değişikliği, e-posta gönderimi, gerçek yayınlama, tüm bağımsız iş türlerinin işçi/dış servis sonuçları bu testte doğrulanmadı. Bu alanlar için “geçti” sonucu verilmemelidir.

## Ek gözlem — Sohbet hata mesajında yeniden deneme eylemi yok

Bileşen değiştirme isteği sırasında test sekmesi erişilemez oldu. Sohbet yeniden açılınca başarısız cevap korundu ve “Yapay zekâ yanıtı tamamlanamadı. Lütfen yeniden deneyin.” gösterildi. Bu ilk kesintiyi bileşen servisinin kesin hatası saymıyoruz; tarayıcı oturumu da kesildi. Ancak hata satırında yeniden deneme düğmesi yoktu; kullanıcı talimatını tekrar yazmak zorunda kaldı. Belge işlem kartında bulunan “Adımı yeniden dene” kolaylığı sohbet cevabında da sağlanabilir.

Araç gözlenebilirliği: Testte okunan genel yanıt kayıtlarında context/research alanları null; tamamlanan sohbet görünümünde de hangi araçların kullanıldığına ilişkin kalıcı bir adım listesi yok. Geçici “Verilere bakıyor” mesajları kullanıcıya çoklu isteğin hangi bölümlerinin gerçekten işlendiğini doğrulatmıyor.

## Son durum — P2: Bileşen değiştirme geçersiz taslak üretti; yanıt ile düğmeler çelişti

İkinci canlı deneme tamamlandı: “Havuzdaki ozet bileşeninin başlığını daha belirgin yapacak değişiklik taslağını tekrar oluştur. Kaydetme.”

- Araç `bilesen_degistir` olarak sunucu olayında görüldü.
- Bekleme bir dakikayı geçti.
- Sonuç kartı **Doğrulama hatası**: `nodes[1]: metin için tam olarak bir kaynak gerekli (text, bind ya da slot)`.
- Karttaki her iki kaydetme düğmesi doğru biçimde kapalıydı.
- Buna rağmen asistan “hazırlandı ve önizleme kartıyla sunuldu” ve “kart üzerindeki butonu kullanabilirsiniz” dedi. Kullanıcı kapalı düğmeye yönlendiriliyor.
- Hatalı taslak önizlemesinde anlamlı bileşen yerine `3` başlığı görüldü.

Beklenen: Model çıktısı doğrulanmıyorsa otomatik düzeltme denenmesi veya açık “taslak hazır değil, kaydedilemez” yanıtı; geçerli önizleme varmış gibi konuşulmaması. Kanıt: `component-validation.png`.

Yeni bileşen üretimi başarılıyken mevcut bileşeni değiştirme gerçek serviste başarıyla tamamlanmış sayılmamalıdır. Kontrollü yönlendirme testi geçmiş olsa bile bu canlı sonuç ayrı bir hatadır.

Son iki kontrol: `raporlari_ara` ile “kablosuz şarj, en fazla 2 sonuç” araması bir kayıt ve doğru biçimli `/reports/...?...revision=2` bağlantısı döndürdü. Uzun cevap isteğinde “Yanıtı durdur” tıklandığında “İşlem isteğiniz üzerine durduruldu” mesajı gösterildi.
