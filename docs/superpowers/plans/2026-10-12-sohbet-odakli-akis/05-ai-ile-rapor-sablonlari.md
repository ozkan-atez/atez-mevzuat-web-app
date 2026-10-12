# AI ile rapor şablonları uygulama planı

Şablon oluştururken kullanıcı raporun hangi bölümlerden oluşacağını ve her bölümün ne anlatacağını tarif edecek. AI bu tariften uygun bölüm düzenini önerecek; aynı talimatlar rapor üretilirken kullanılacak.

## Ekran akışı

Şablon adı ve kullanım amacından sonra sıralanabilir bölüm kartları gösterilir. Her kartta bölüm adı, kısa açıklama, gerekiyorsa ayrıntılı AI talimatı ve dahil etme seçeneği bulunur. Kullanıcı yeni bölüm ekleyebilir veya önerilen bölümlerle başlayabilir.

| Bölüm | Kullanıcıya önerilecek açıklama |
| --- | --- |
| Yönetici özeti | Önemli değişiklikleri ve karar gerektiren noktaları kısa biçimde özetle. |
| Kaynak ve yürürlük | Düzenlemenin dayanağını, yayın tarihini ve yürürlüğe giriş koşullarını belirt. |
| Etki analizi | Etkilenen süreçleri, ekipleri, maliyetleri ve uyum konularını açıkla. |
| GTİP karşılaştırması | Kaynaklarda bulunan GTİP kodlarını ve önceki ile yeni değerleri karşılaştır; dayanağı göster. |
| Önerilen aksiyonlar | Bulgulara dayalı uygulanabilir adımları listele; kaynakta olmayan sorumlu veya tarihi kesin bilgi gibi yazma. |

“AI ile yapıyı öner” başlık ve açıklamalardan bölüm düzeni ile uygun bileşenleri önerir. Kullanıcı öneriyi düzenler, önizler ve kaydeder. AI beklenirken form kaybolmaz; öneri başarısızsa kullanıcı bölümleri elle kaydedebilir. Şablon önizlemesindeki örnek içerik gerçek araştırma sonucu gibi sunulmaz.

## Bölüm sözleşmesi

Mevcut `id`, `heading`, `html`, `enabled` alanlarına `description`, `instruction`, `order`, `componentType`, `required` ve şema sürümü eklenmesi önerilir. Kaynak bağlantıları ayrı ilişki olarak bölümün kalıcı kimliğine bağlanır. Başlığı değiştirmek kimliği değiştirmez; aynı başlıklı farklı bölümler desteklenir.

İçerik talimatı ile görsel bileşen ayrılır. “Etki analizi” semantik bölüm, paragraf veya tablo görsel düzenidir. AI yalnız izin verilen düzen bileşenlerini seçer; kurumsal HTML iskeleti ve doğrulayıcı korunur. Serbest bölüm açıklamalarının mevcut normalizasyon tarafından varsayılan başlığa geri çevrilmesi önlenir.

Rapor üretimi başlangıcında şablonun sürümü, sırası, açıklamaları ve kaynak eşlemeleri sabitlenir. Kullanıcı şablonu daha sonra değiştirse bile önceki rapor veya sürmekte olan işin yapısı değişmez. Zorunlu ve isteğe bağlı bölümlerin eksik kanıt davranışı ayrı tanımlanır: zorunlu bölüm eksikliği tamamlanmayı engeller; isteğe bağlı bölüm açık eksiklik notuyla üretilebilir veya kullanıcının belirlediği kuralla atlanabilir.

## Uygulama işleri

- [ ] `TemplatesPage` ve `VisualTemplateEditor` bölüm kartları ile açıklama girişlerini destekler; teknik bileşen kodları birincil kullanıcı dili olmaktan çıkarılır.
- [ ] `TemplateSection` tipi ve backend `sectionSchema` genişletilir. Eski şablonlar uyumlu varsayılanlarla okunur; yeni zorunluluk kuralları geçmiş şablonları kendiliğinden engellemez.
- [ ] AI öneri işlemi kalıcı istek ve kullanım kaydıyla oluşturulur. Sonuç şema doğrulamasından geçer ve kaydetmeden önce kullanıcıya gösterilir.
- [ ] `report-template-catalog.ts` ve `normalizeTemplateSections` yeni semantik başlıkları ve açıklamaları korur.
- [ ] `apply-automation-template.ts`, `build-report-spec.ts` ve bağımsız `BUILD_REPORT` yolu bölüm talimatlarını gerçek üretim girdisi olarak kullanır; sadece önizleme metnini değiştirmek yeterli değildir.
- [ ] Şablon güncellemesi revision artırır; aynı anda yapılan düzenlemeler çakışma kontrolünden geçer. Kaynak bağlamı 04 ile bağlanır.

İlgili alanlar: `frontend/src/features/workspace/CatalogPages.tsx`, `VisualTemplateEditor.tsx`, `api.ts`; `backend/src/modules/workspace/workspace.routes.ts`, `report-template-catalog.ts`; `backend/src/modules/topic-analysis/application` ve `operations` üretim yolları.

## Kabul ve doğrulama

- Beş örnek bölüm, kullanıcı sırası ve açıklamalarıyla kaydedilip yeniden açılır.
- Bölüm açıklaması değiştiğinde yeni rapor üretiminin talimatı değişir; eski rapor aynı kalır.
- GTİP kanıtı yokken karşılaştırma verisi uydurulmaz; eksik kaynak veya uygulanamaz bölüm açıkça gösterilir.
- AI önerisi formdaki kullanıcı girdisini habersiz silmez; başarısız AI çağrısında elle çalışma sürer.
- Mevcut şablonlar ve hem otomasyon hem sohbet rapor üretimi regresyon testlerinden geçer.
