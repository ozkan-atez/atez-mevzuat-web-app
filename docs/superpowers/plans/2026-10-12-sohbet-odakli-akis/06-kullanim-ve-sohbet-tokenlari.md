# Kullanım ve sohbet tokenları uygulama planı

Kullanım ekranı sohbet tüketimini ayrı kalemlerle gösterecek. Kullanıcı toplam tüketimden ilgili sohbete, rapora veya işleme ulaşabilecek.

## Ekran düzeni

Üst özet seçili dönemin toplam tokenını, sohbet tüketimini, rapor işlemleri tüketimini ve işlem sayısını gösterir. Döküm kategorileri Genel sohbet, Rapor sohbeti ve revizyonu, Tarama ve analiz, Kaynak kurulumu, Şablon oluşturma olur. Sohbetten başlayan taramanın analiz çağrısı Tarama ve analiz kategorisinde sayılır; başlatan sohbet bağlantısı ayrıca korunur.

Tabloda tarih, işlem kategorisi, sohbet veya rapor adı, işlemi yapan kişi, model, girdi tokenı, çıktı tokenı, toplam ve durum bulunur. Tarih, kategori, kullanıcı ve rapor filtreleri ile ayrıntı ekranı sunulur. Örnek satır: “Yönetici özeti düzenlemesi · Ayşe · Rapor revizyonu”.

Kullanıcının kendi tüketimi görünürdür. Ekip toplamı ve başkalarının ayrıntılarını görme ayrı yetkiyle sınırlandırılır; rapor sohbetini görme hakkı tüm ekip kullanımını görme hakkı sayılmaz. Erişilemeyen özel sohbetlerin başlıkları kullanım ekranına sızmaz.

## Ölçüm sözleşmesi

Önerilen tekil AI kullanım olayı çalışma alanı, aktör, sağlayıcı, model, çağrı veya deneme kimliği, kategori, mesaj, sohbet, rapor, işlem ve zaman bilgileriyle kaydedilir. Bir çağrı yalnız bir ana kategoride sayılır; rapor ve sohbet ilişkileri filtreleme içindir ve toplamı ikiye katlamaz.

Girdi ve çıktı tokenları sağlayıcının bildiriminden gelir. Önbellek veya düşünme tokenları destekleniyorsa ayrı tutulur ve sağlayıcının toplam tanımına göre hesaplanır; alt kalemler yeniden eklenmez. Bildirilmeyen değerler boş ve “Ölçüm bilgisi yok” olur. Eski sohbetlere tahmini gerçek tüketim yazılmaz.

Sohbet tek bir mesaj için birden çok model ve araç turu çalıştırabilir. Her sağlayıcı çağrısı ve yeniden deneme ayrı ölçülür. Akış boyunca tekrar gelen kümülatif token bilgileri toplanmaz; aynı çağrının son bilgisi tek kaydı günceller. Hatalı veya durdurulan çağrının bilinen tüketimi korunur. AI çağrısı yapılmayan kayıt sorgusu, kayıttan doğrulanabiliyorsa sıfır tüketimli olarak ayrılır.

## Uygulama işleri

- [ ] `chat-model-client.ts` ve `gemini-chat-model-client.ts` token metadata olayını taşır. Tarayıcı araştırması ve web araştırması yolları da kapsanır.
- [ ] `send-chat-message.ts` çok turlu çağrıları mesaj ve oturumla ilişkilendirerek ölçümü kaydeder. Kullanıcı bağlantıyı kapatsa da elde edilmiş tüketim kaybolmaz.
- [ ] Revizyon, kaynak kurulum ve şablon öneri çağrıları aynı kayıt sözleşmesine bağlanır; 02–05 geliştirmelerinde ölçüm birlikte eklenir.
- [ ] Mevcut `AiCall`, `TopicAiExecution`, `PreviousSourceCall` tüketimleri ile ortak kullanım olayının geçiş kuralı yazılır. Her çağrının tek kayıt kaynağı ve geçiş zamanı vardır; eski toplamla yeni toplam körlemesine toplanmaz.
- [ ] `/api/v1/usage` dönem ve kategori toplamlarıyla genişletilir; sayfalanan ayrıntı uç noktası eklenir. Sorgular gerçek çalışma alanı ve yetkiyi uygular.
- [ ] `UsagePage` ve `workspace/api.ts` yeni özet, filtre, ölçüm durumu ve ayrıntı bağlantılarını gösterir.

## Kabul ve doğrulama

- Çok turlu sohbetin toplamı sağlayıcı çağrılarının tekil toplamına eşittir.
- Akışta yinelenen kullanım olayı iki kez sayılmaz; gerçek yeniden deneme ayrı tüketimdir.
- İptal, hata, eksik sağlayıcı ölçümü ve AI çağrısı yapılmadan cevaplanan kayıt sorgusu ayırt edilir.
- Genel sohbet ve rapor revizyonları ayrı satırlardır; sohbetten başlayan rapor üretimi toplamda çift sayılmaz.
- Dönem filtresi İstanbul gün sınırlarında doğrudur. Başka çalışma alanının veya yetkisiz özel sohbetin ayrıntıları görünmez.
- Model adaptörü birim testleri, kullanım toplama ve erişim API testleri ile kullanım ekranı testleri uygulanır.
