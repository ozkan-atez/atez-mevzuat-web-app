# Sohbet ve kaynak seçimi uygulama planı

Sohbet, tarama ve araştırmanın ana girişidir. Kaynaklar artı menüsünden seçilir; kullanıcının gördüğü kapsam ile sistemin eriştiği içerik aynı olmalıdır.

## Kullanıcı akışı

1. Yeni tarama başlat, sohbeti açar. Kullanıcıdan neyi ve hangi tarihi incelemek istediği alınır.
2. Mesaj kutusundaki **+** menüsü Kaynak seç, Dosya yükle, Bağlantı ekle ve Belgelerimden seç seçeneklerini sunar. Kayıtlı kaynak seçicisi çoklu seçim, arama ve Hazır / Kuruluyor / Erişim gerekiyor durumlarını gösterir.
3. Seçilen kaynaklar ve dosyalar mesaj kutusunun üzerinde kaldırılabilir etiketlerdir. “Yanıtlar yalnızca seçtiğiniz kaynaklara dayanır” açıklaması görünürdür.
4. Kaynak, tarih ve gerekiyorsa şablon net olduğunda istek çalıştırılır. Sistem kısa bir kapsam özeti ve işlem durumu gösterir. Kullanıcıdan aynı bilgi yeniden istenmez.
5. Sonuç kullanılan belge ve bağlantılara atıf verir. Rapor oluştuğunda Raporu aç eylemi ve rapora bağlı sohbet bağlantısı gösterilir.

Tarama girişinde kaynak seçilmemişse kaynak seçici açılır; bütün kaynaklara örtülü geçiş yapılmaz. Genel selamlaşma veya uygulama yardımı kaynak seçmeden çalışabilir. Bir tarih belirtilmemişse tarama için bugün önerisi İstanbul tarihine göre görünür biçimde gösterilir; tarih belirsizliği sessizce çözülmez.

Web’de ara ve mevcut tarayıcı araştırması ayrı kapsam seçenekleridir. Seçili kaynak modu açıkken genel web araştırması otomatik açılmaz. Kullanıcı modu değiştirirse değişen kapsam görünür olur; özel belgeler genel arama sorgusuna taşınmaz. Artı menüsüne kaynak seçimi eklenirken mevcut dosya ve araştırma araçları kaybolmaz.

## Sunucu tarafındaki kapsam

Önerilen `ChatContext` sözleşmesi `mode`, `sourceIds`, `documentVersionIds`, isteğe bağlı `templateId` ve `templateRevision` taşır. Oturum son seçimi hatırlar; her mesajda kullanılan kapsamın değişmez kopyası saklanır. Kaynakların profil sürümleri ve sonradan toplanan belge sürümleri işlem sonucuna bağlanır.

Kapsam yalnızca AI talimatına yazılmaz. Bilgi sorguları, tarama komutları, önceki kaynak araştırması, Tariff sorgusu, rapor oluşturma ve diğer yardımcı araçlar aynı izinli kaynak kümesini sunucuda uygular. Seçili bir kaynaktaki dış bağlantı başka kaynağa sessiz erişim izni vermez. Tariff veya önceki mevzuat için ilave kaynak gerekirse eksik kapsam açıkça belirtilir.

Kaynak seçiminden çıkarılan bir kaynağın eski yanıtları hâlâ sohbet geçmişinde olabilir. Yeni model bağlamı hazırlanırken önceki alıntılar ve araç sonuçları kapsam bilgileriyle filtrelenir; aksi halde eski kaynağın içeriği yeni yanıta sızabilir. Ekrandaki geçmiş korunur, yeni yanıtın kanıt kümesi güncel seçimle sınırlandırılır.

Kaynak erişimi her istekte yeniden denetlenir. Hazır olmayan, silinmiş veya kullanıcının erişemediği bir kaynak sessizce atlanmaz; eksik seçim kullanıcıya bildirilir. Rapor şablonunun zorunlu kaynaklarıyla seçim çelişiyorsa eksik bölüm ve kaynak gösterilir.

## Uygulama işleri

- [ ] `ConversationComposer` ve `ComposerAttachments` ortak artı menüsünü ve kaynak etiketlerini yönetir; başarısız gönderimde talimat ve seçimler korunur.
- [ ] `ChatScreen`, `useConversation`, `api.ts`, `types.ts` kaynak kapsamını ilk yönlendirme, yeniden açılış ve mesaj gönderiminde taşır.
- [ ] `chat.routes.ts`, `ports.ts`, sohbet repository ve Prisma modelleri oturum varsayılanı ile mesaj kapsamını saklar.
- [ ] `send-chat-message.ts`, `chat-tools.ts`, `chat-operations.ts`, `scan-intent.ts` ve bilgi sorguları ortak kapsam doğrulayıcısını kullanır.
- [ ] Kaynaklı yanıtın kullanılan belgeleri ve kapsam eksikleri döner; uzun işlemler yeniden açılan sohbette izlenebilir.
- [ ] İlk mesajın tekrar gönderilmesine karşı mevcut yönlendirme koruması ve işlem idempotency anahtarları korunur.

İlgili dizinler: `frontend/src/features/chat`, `frontend/src/features/documents`, `backend/src/modules/chat`, `backend/src/modules/operations` ve `backend/prisma/schema.prisma`.

## Kabul ve doğrulama

- A ve B seçiliyken çıkarılan B sonraki yanıtta kullanılmaz; eski sohbet geçmişinden de kanıt olarak geri gelmez.
- Kaynak sınırını aşan araç isteği sunucuda reddedilir; yalnızca arayüz filtresine güvenilmez.
- Dosya, URL ve arşiv seçimleri aynı belge sürümünü yeniden kullanabilir; dosya yüklemek kendi başına tarama başlatmaz.
- Sayfa yenileme, çift tıklama ve ağ tekrarında aynı talep ikinci tarama üretmez.
- Boş seçim, erişim kaybı, kısmi kaynak hatası ve okunamayan belge anlaşılır mesajla gösterilir.
- Composer ve sohbet testleri; backend sohbet sözleşmesi, kaynak kapsamı, tarama araçları ve aktör izolasyonu testleri güncellenir.
