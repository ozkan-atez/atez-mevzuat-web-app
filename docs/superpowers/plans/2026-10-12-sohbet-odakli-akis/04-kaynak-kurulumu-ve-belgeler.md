# Kaynak kurulumu ve yerel belgeler uygulama planı

Kaynaklar ekranı bağlantı kurma, belge ekleme ve rapor bağlamı tanımlama alanı olacak. Kaynaklar kendi başına sürekli çalışan işler olmayacak.

## Kaynak oluşturma

Kullanıcı Web kaynağı veya Dosya kaynağı seçer. Web kaynağı için ad, bağlantı, kısa amaç ve gerekiyorsa kullanıcı adı ile parola girilir. Dosya kaynağında ad, açıklama ve yüklenen veya arşivden seçilen belgeler bulunur. Teknik kısa kod sistem tarafından üretilir.

Kaydetme sonrasında web kaynağı için arka planda kurulum işi başlar. Kullanıcıya “Bağlantı hazırlanıyor”, “Hazır”, “Giriş bilgisi gerekiyor” veya “Kurulum tamamlanamadı” gösterilir. Kaynak kartında Düzenle, **Bağlantıyı test et** ve Şablon bağlamı bulunur. Üretim taraması bu ekranda ayrı modal açmaz; gerekirse Sohbette kullan seçeneği kaynak seçili sohbeti açar.

Bağlantı testi oturum açma ve sınırlı örnek belge okumasını kontrol eder; rapor üretmez, sürekli takip oluşturmaz. Son test zamanı ve kısa sonucu görünür. Dosya kaynağı için bağlantı testi yerine belgelerin okunabilirlik durumu gösterilir.

## Kurulum işinin sınırı

Mevcut `profile-discovery.ts` bilinen profiller ve HTML kurallarıyla keşif yapıyor. Bu iş tek başına AI kurulum motoru olarak adlandırılmamalı. Hedef kurulum, bu deterministik keşfi kullanıp gerektiğinde AI ile okuma profili taslağı üretir; ardından profil şema, adres kapsamı, örnek kayıt ve belge okuma testlerinden geçer. Modelin ürettiği rastgele kod çalıştırılmaz.

Kurulum tek seferlik, izlenebilir ve tekrar denemesi sınırlı kuyruk işidir. Adres veya hesap bilgisi değişince profilin yeniden doğrulanması gerekir. Oturum doğrulaması kullanıcı etkileşimi gerektirirse kaynak hazırmış gibi işaretlenmez.

Parolalar mevcut şifreli saklama mekanizması üzerinden yazılır; API yanıtı, model talimatı ve günlükler parolayı içermez. Mevcut `source-profile.routes.ts` içinde bulunan sabit `workspaceId: 'local'` credential yolları ekip dağıtımından önce gerçek çalışma alanına bağlanır. Kaynak listesi, test, kurulum ve kullanım erişimleri aynı kapsamı denetler.

## Sürekli yenilemeden talep üzerine çalışmaya geçiş

`worker.ts` başlangıçta ve altı saatte bir `refreshActiveSources` kuyruğuna iş gönderiyor. Yeni davranışta kaynak kaydı bu zamanlayıcıya bağlı olmaz. Yeni periyodik mesaj üretimi kapatılır; bekleyen eski yenileme işlerinin sürüm veya politika kontrolüyle kendiliğinden çalışma başlatması önlenir.

Kaynak içeriği yalnız açık sohbet isteği, kayıtlı otomasyon çalışması veya sınırlı bağlantı testi sırasında okunur. Rapor otomasyonları kendi zamanlamalarında çalışmaya devam eder ve gerekli belge toplama adımını kendileri yürütür. Kaynak kataloğunu açmak veya sayfayı yenilemek dış site taraması başlatmaz.

## Yerel belge ve şablon bağlamı

Dosya kaynakları `Document`, `DocumentVersion` ve mevcut depolama altyapısını kullanır. Birden çok belge bir kaynak koleksiyonunda gruplanabilir; raporda kullanılan sürümler sabitlenir. Bir dosyanın yeni sürümünü eklemek eski raporun dayanağını değiştirmez. Prototipte PDF, DOCX ve HTML örnekleri vardır; gerçek uygulamanın desteklediği dosya türleri ve boyut sınırları sunucudan tek sözleşmeyle arayüze aktarılır.

Kaynak bağlamında şu sorular kullanılır: “Bu kaynaktan hangi bilgiyi alacağız?”, “Hangi tarihe göre inceleyeceğiz?”, “Hangi sorulara yanıt arıyoruz?” ve “Raporun hangi bölümlerinde kullanılsın?” Şablon bağlantısı birden fazla şablona izin verir. Her bağlantı şablon ve bölüm kimlikleri, birincil veya destekleyici rol, zorunluluk ve kısa talimat taşır.

Şablon değiştiğinde silinen veya değiştirilen bölüm bağlantıları kullanıcıya gösterilir. Kaynak tanımlamak için şablon seçmek zorunlu değildir; bir rapor üretiminde seçilen şablonun zorunlu kaynaklarının hazır olması gerekir.

## Uygulama işleri

- [ ] `SourcesPage`, `ManagedSourcesPanel`, `SourceActions` ve `SourceProfilePanel` tek kaynak deneyiminde düzenlenir. İç kaynak ve ek bağlantı ayrımı kullanıcıya anlaşılır tek katalogla sunulur.
- [ ] `Source`, `ManagedSource` ve yerel belge koleksiyonu için açık türler ve eşleme oluşturulur; mevcut kimlikler ve belge ilişkileri korunur.
- [ ] Kurulum işi, test sonucu ve kaynak durumları kalıcı tutulur; mevcut işlem kuyruğu genişletilir.
- [ ] Yerel kaynak koleksiyonu ilişkileri ve şablon bölüm bağlantıları eklenir; 05 bölüm kimliği sözleşmesi kullanılır.
- [ ] Kaynak periyodik yenileme üreticisi ve tüketici davranışı yeni kurala geçirilir.

İlgili alanlar: `frontend/src/features/workspace`, `frontend/src/features/documents`, `backend/src/modules/managed-sources`, `backend/src/modules/documents`, `backend/src/modules/operations`, `backend/src/worker.ts` ve Prisma şeması.

## Kabul ve doğrulama

- Kaynak eklemek bir kurulum işi başlatır; yinelenen rapor taraması oluşturmaz. Yeniden deneme aynı profil sürümünü iki kez yayımlamaz.
- Bağlantı testi sınırlı içerikle çalışır, rapor veya dağıtım üretmez.
- Bir çalışma alanının kaynağı ve hesabı başka alandan kullanılamaz; parola hiçbir okuma yanıtında görünmez.
- Dosya yükleme, okunamayan belge, yeni belge sürümü ve eksik zorunlu kaynak durumları test edilir.
- Zaman ilerletildiğinde kaynağın kendi başına yenilenmediği; kayıtlı otomasyonun ise gerekli veriyi hâlâ alabildiği doğrulanır.
