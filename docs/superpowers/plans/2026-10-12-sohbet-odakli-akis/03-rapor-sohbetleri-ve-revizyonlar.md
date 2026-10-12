# Rapor sohbetleri ve ekip revizyonları uygulama planı

Her rapor sohbetlerini, AI önerilerini, elle yapılan değişiklikleri ve yayımlanmış sürümlerini bir arada toplar. Rapor sohbetlerini rapora erişen ekip üyeleri görür; düzenleme ve yayımlama hakları ayrı denetlenir.

## Sohbet listesi ve çalışma alanı

Sohbetler ekranı Genel sohbetler ve Raporlar gruplarına ayrılır. Rapor grubu açılınca o rapora bağlı sohbetler, son değişiklik ve son sürüm görünür. Bir raporun altında farklı amaçlarla birden fazla sohbet açılabilir; örneğin Yönetici özeti düzenlemesi ve GTİP karşılaştırması. Genel sohbetten üretilen rapora ilgili üretim mesajı bağlanır; genel sohbetin tamamı ekibe otomatik açılmaz.

Rapor düzelt ekranında AI alanı ilk görünümde fark edilir olmalıdır. “AI ile raporu düzenle” başlığı, AI simgesi, ince mor ve mavi gradient kenarlık, kısa açıklama ve örnek talimatlar kullanılır. “Yönetici özetini kısalt”, “Etki analizini ayrıntılandır” gibi örnekler mesaj kutusunu doldurur. Durum yalnız renkle anlatılmaz; klavye odağı, açık ve koyu tema, dar ekran ve azaltılmış hareket tercihi desteklenir.

Geniş ekranda rapor önizlemesi ile açık sohbet alanı yan yana; mevcut 960 piksel çekmecede ve dar ekranda okunabilir panel veya sekme düzeni kullanılır. Mesaj kutusu erişilebilir kalır. Konuşma geçmişi yalnızca kapalı bir geçmiş bölümünün içinde saklanmaz. Konu raporları, tarama raporları ve bağımsız belge raporları aynı deneyimi sunar.

## Değişiklik ve sürüm davranışı

AI önerileri bölüm bazında önce ve sonra görünümüyle sunulur. Kullanıcı değişiklikleri tek tek veya topluca taslağa alabilir. Her kayıtta talebi yapan, uygulayan, zaman, AI veya manuel yöntemi, başlangıç sürümü ve sonuç sürümü bulunur. “Taslağa uygulandı” ile “Yeni sürüm kaydedildi” ayrı durumlardır.

Sürümler paneli sürümü görüntüleme, iki sürümü karşılaştırma, bu sürümden devam etme ve seçilen bölüm değişikliklerini mevcut taslağa alma işlemlerini sunar. Eski bir sürümden devam etmek yeni taslak oluşturur. Kaydetme yeni, artan sürüm numarası üretir; eski sürümün içeriğini veya numarasını değiştirmez.

Eşzamanlı düzenlemede `baseVersion` yanında taslağın değişiklik sayacı veya revision değeri denetlenir. Başka biri taslağı değiştirmişse sessiz üzerine yazma yapılmaz. Kullanıcıya güncel değişiklikler gösterilir; çakışmayan alanlar yeniden uygulanabilir, aynı alanı etkileyen değişiklikler açık seçim ister. Seçili eski değişiklikler alınırken güncel alan değeri başlangıç değeriyle karşılaştırılır.

## Veri ve API işleri

- [ ] `TopicReport.id` rapor çalışma alanının ortak kimliği olarak kullanılır; mevcut topic, run ve standalone yolları buna eşlenir.
- [ ] Bir rapora çoklu sohbet ilişkisi eklenir. Öneri: `ReportConversation` ve mesaj kayıtları; genel `ChatSession` erişim sınırı korunur. Mevcut `AnalysisThread` geçmişi salt okunur adaptörle aynı akışta gösterilir veya kimlikleri korunarak taşınır.
- [ ] Mesaj, öneri, taslak değişikliği ve sürüm arasında izlenebilir ilişkiler kurulur. `ReportFieldEdit` ve `ReportRevision` düzeyinde aktör ve başlangıç bilgileri tamamlanır. Silinen kullanıcılar için geçmiş atıf korunur; eski kayıtta kişi tahmin edilmez.
- [ ] Liste, mesaj, öneri uygulama, karşılaştırma ve yeni taslak işlemleri rapor erişim denetiminden geçer. Önerilen yollar rapor kimliği altında `/conversations`, `/revisions`, `/compare`, `/drafts` aileleridir; kesin sözleşmeler uygulama başında mevcut route yapısına göre belirlenir.
- [ ] `ChatScreen` içindeki yalnız GENERAL filtresi ve repository geçmiş sorgusu gruplu sonuç destekler. Sayfalama hem rapor gruplarında hem mesajlarda uygulanır.
- [ ] Rapor sohbetini arşivlemek revizyon kanıtını silmez. Genel sohbet silme uç noktası rapor sohbetine veya rapor geçmişine etki etmez.
- [ ] Özel belge içeren sohbet ekiple paylaşılmadan belge erişimi kontrol edilir. Yetkisiz belge içerikleri ve önizlemeleri sohbet üzerinden açığa çıkarılmaz.

Mevcut yetkiler `report.read`, `report.edit`, `report.publish` ve aktör kapsamından alınır. Rapora erişim hakkı bulunan görüntüleyici sohbeti okuyabilir; yazma ve değişiklik yapma için ayrıca uygun izin gerekir. Mevcut erişim modeli kişisel ve çalışma alanı görünürlüğü içeriyor; rapor sohbeti bu politikayı devralır, şirketteki herkese yeni erişim vermez.

İlgili dosyalar: `frontend/src/features/chat/ChatScreen.tsx`, `ConversationHistory.tsx`, `features/revision/ReportWorkspace.tsx`, `ReportCorrectionDrawer.tsx`, `ChangeList.tsx`, `useReportDraft.ts`, `features/reports/StandaloneReportCorrection.tsx`; backend `chat`, `topic-analysis`, `operations` modülleri, `platform/actor-context.ts` ve Prisma şeması.

## Kabul ve doğrulama

- İki yetkili üye aynı raporda çalışabilir; herkes kimin hangi değişikliği yaptığını görebilir. Yetkisiz kişi liste, doğrudan URL, mesaj ve sürüm API yollarından erişemez.
- Otomasyon raporuna AI düzenlemesi üretim türünü değiştirmez.
- Eski sürümü görüntülemek yayımlanmış sürümü değiştirmez; geri alma yeni sürüm ve faaliyet kaydı üretir.
- Yalnız seçilen bölümler taslağa alınır; bağımlı değişiklikler varsa eksik seçim açıklanır.
- Eşzamanlı aynı alan düzenleme, eski taslaktan yayımlama ve yeniden gönderim senaryoları test edilir.
- `ReportWorkspace` ve standalone düzeltme testleri ile backend taslak sınırları, rapor soyu ve erişim izolasyonu testleri genişletilir.
