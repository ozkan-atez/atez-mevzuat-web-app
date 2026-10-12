# Dashboard ve rapor listesi uygulama planı

Yeni tarama girişleri sohbeti açacak; rapor listesi raporun otomasyondan mı kullanıcı talebinden mi doğduğunu gösterecek.

## Ekran davranışı

Dashboard başlığındaki Yeni tarama başlat kaldırılır. Mevcut asistan alanı korunur; Başla yerine Sohbete geç kullanılabilir. Girilen talimat sohbet girişine aktarılır. Kaynak seçimi gerektiren tarama talebi, kaynak seçilmeden iş kuyruğuna gönderilmez.

Diğer sayfalardaki Yeni tarama başlat, `/chat` üzerinde tarama niyetiyle yeni çalışma açar. Kaynak ve tarih önerileri aktarılabilir; yönlendirme taramayı çalıştırmaz. Sayfa yenileme veya geri dönüş ikinci bir tarama başlatmaz. İzin kontrolü hem sohbet yazma hem tarama çalıştırma adımlarına uygulanır.

Rapor tablosunda Tür sütunu **Otomasyon / Manuel** olur. Mevcut Mevzuat raporu, Belge analizi ve Değişiklik yok ayrımı **İçerik** filtresine taşınır. Otomasyon adı, kaynaklar ve başlatan kişi satır ayrıntısında gösterilir. Otomasyon ve manuel raporlar aynı liste ve sıralamayı kullanır. Mobil görünümde tür etiketi başlığın altında kalır.

## Köken sözleşmesi

Önerilen rapor liste yanıtı `reportId`, `origin`, `automationId`, `automationName`, `initiatedBy`, `contentType`, `latestVersion` alanlarını içerir. `origin` yeni kayıtlarda `AUTOMATION` veya `MANUAL`; geçmişte saptanamayan kayıtta boş olur ve Belirlenemedi gösterilir.

Köken, sunucuda raporu oluşturan doğrulanmış işlemden belirlenir. Yalnızca `ScanRun.trigger` kullanmak yeterli değildir: kayıtlı otomasyon elle başlatılmış olabilir. Otomasyon ilişkisi, işlem kaynağı ve çalışma ilişkileri birlikte değerlendirilir. Tarama dışı belge raporlarına otomatik olarak Manuel atamadan önce otomasyon işlemiyle ilişkisi kontrol edilir.

## Uygulama işleri

- [ ] `StartScanAction.tsx` modal açmak yerine sohbet yönlendirmesi kullanır; eski modalın diğer kullanımları envanterlenir.
- [ ] `Dashboard.tsx` başlık eylemi kaldırılır; ilk talimat aktarımı 02 planındaki kapsam adımıyla uyumlu hale getirilir.
- [ ] `ReportsIndex.tsx` tür ve içerik filtrelerini ayırır; kullanıcıya açık etiketler ortak sabitlerden gelir.
- [ ] Liste için ortak, yetkili ve sayfalanan rapor sorgusu oluşturulur. Mevcut son 50 taramayı ayrı ayrı okuyup belge raporlarıyla birleştiren yol, toplam filtreleme ve sayfalama için genişletilir veya tek uç noktaya taşınır.
- [ ] Köken alanları oluşturma ve yayımlama işlemlerinde taşınır; eski veriler kanıtlanabilir ilişkilerle doldurulur.

İlgili dosyalar: `frontend/src/features/scans/StartScanAction.tsx`, `dashboard/Dashboard.tsx`, `reports/ReportsIndex.tsx`, `reports/standalone-api.ts`, `scans/types.ts`; backend rapor listeleme ve üretme yolları, `operations/operation-service.ts`, `workspace` otomasyon yürütmesi ve Prisma şeması. Bu yollar `frontend/src/features` ve `backend/src/modules` altındadır.

## Kabul ve doğrulama

- Butona tıklama sohbeti açar; tarama oluşturma çağrısı yapmaz. Dashboardda kaldırılan eylem yoktur.
- Sohbetten üretilen rapor Manuel; zamanlanmış veya elle başlatılmış kayıtlı otomasyon raporu Otomasyon görünür.
- AI ile düzeltilen otomasyon raporunun üretim türü değişmez.
- Tür filtresi sayfalar arasında doğru toplam verir; yetkisiz raporlar listeye katılmaz.
- Mevcut `Dashboard.test.tsx`, `DashboardChat.test.tsx`, `ReportsIndex.test.tsx` ve ilgili liste API testleri yeni davranışa göre güncellenir.
