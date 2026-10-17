/**
 * Varsayılan şablon seed'i: "ATEZ Günlük Mevzuat — Tüm bileşenler" (2026-10-17 kararı).
 * Havuzdaki bütün aktif bileşenler açık gelir; her bölümün başlığı ve açıklaması doludur.
 * Açıklamalar eski "Rapordan ne bekleniyor?" metnindeki beş başlıktan (Yönetici özeti, Kaynak ve
 * yürürlük, Etki analizi, GTİP karşılaştırması, Önerilen aksiyonlar) ilgili bölümlere dağıtıldı.
 */
export const SEED_TEMPLATE = {
  seedKey: 'atez-gunluk-tum-bilesenler',
  title: 'ATEZ Günlük Mevzuat — Tüm bileşenler',
  description: 'Havuzdaki bütün aktif bileşenleri içeren varsayılan günlük rapor.',
  brief:
    'Gümrük müşavirleri, ithalatçı ve ihracatçılar için günlük mevzuat raporu. Dil resmî, kısa ve tarafsız. Önce ne değiştiğini ve karar gerektiren noktaları, sonra sayısal etkiyi, tarihleri ve firmaların yapması gerekenleri öne çıkar. Kaynak bilgisi ile yorumu ayır; kaynakta olmayan bilgiyi yazma.',
}

/** Bileşen anahtarı → bölüm başlığı ve açıklaması. Listede olmayan aktif bileşenler kendi adı ve açıklamasıyla gelir. */
export const SEED_SECTIONS: Record<string, { heading: string; sectionDescription: string; required?: boolean; missingDataRule?: 'NOTE' | 'OMIT' }> = {
  ozet: {
    heading: 'Yönetici özeti',
    sectionDescription: 'Önemli değişiklikleri ve karar gerektiren noktaları kısa biçimde özetle. Ne yayımlandı, ne değişti ve ne zaman yürürlüğe giriyor sorularına iki üç cümlede cevap ver.',
    required: true,
    missingDataRule: 'NOTE',
  },
  'onemli-noktalar': {
    heading: 'Öne çıkanlar',
    sectionDescription: 'Yönetici özetini tamamlayan, karar gerektiren noktaları madde madde ver. Her madde tek cümle olsun; sayıları analizdeki gibi kullan.',
  },
  'yeni-duzenleme': {
    heading: 'Düzenleme',
    sectionDescription: 'Düzenlemenin neyi getirdiğini ya da neyi değiştirdiğini anlat; değiştirilen düzenlemeyi ve maddeyi belirt.',
  },
  'karsilastirma-tablosu': {
    heading: 'GTİP karşılaştırması',
    sectionDescription: 'Kanıtlarda bulunan GTİP kodlarının önceki ve yeni durumunu karşılaştır; dayanağı (TARIFF ya da önceki belge) göster. Bilgi yoksa uydurma.',
  },
  'gtip-tablosu': {
    heading: 'GTİP değerleri',
    sectionDescription: 'Önceki hal bulunamadığında yalnızca yeni değerleri tanıt; önceki değer varmış gibi yazma.',
  },
  yururluk: {
    heading: 'Kaynak ve yürürlük',
    sectionDescription: 'Kaynakları, yayımlanma ve yürürlük tarihlerini, varsa geçiş hükümlerini belirt. Yayım tarihi, önceki hal tarihi ve yürürlük tarihini birbirinin yerine kullanma.',
    missingDataRule: 'NOTE',
  },
  'sure-uzatimi': {
    heading: 'Süre uzatımı',
    sectionDescription: 'Uzatılan sürenin eski ve yeni bitişini ve kimleri etkilediğini belirt.',
  },
  'yururlukten-kaldirma': {
    heading: 'Yürürlükten kaldırma',
    sectionDescription: 'Hangi düzenlemenin ya da maddenin kaldırıldığını ve uygulamadaki sonucunu açıkla.',
  },
  duyuru: {
    heading: 'Duyuru',
    sectionDescription: 'Duyurunun özünü ve ilgilileri kısaca anlat.',
  },
  'degisiklik-yok': {
    heading: 'Değişiklik yok',
    sectionDescription: 'İlgili bir değişiklik olmadığını kısa ve net söyle.',
  },
  etkilenenler: {
    heading: 'Etki analizi',
    sectionDescription: 'Etkilenen tarafları, iş süreçlerini, maliyet ve uyum etkilerini açıkla. Kaynak bilgisi ile yorumu ayır.',
  },
  'onerilen-aksiyonlar': {
    heading: 'Önerilen aksiyonlar',
    sectionDescription: 'Bulgulara dayalı uygulanabilir adımlar öner. Kaynakta bulunmayan sorumlu ve tarihleri kesin bilgi gibi sunma.',
  },
  istisnalar: {
    heading: 'İstisnalar ve geçiş hükümleri',
    sectionDescription: 'İstisnaları, geçiş hükümlerini ve belirsiz noktaları ayrı ayrı belirt.',
  },
  'onceki-hal-uyarisi': {
    heading: 'Önceki hal',
    sectionDescription: 'Önceki hal bulunamadıysa ya da belirsizse bunu açıkça belirt.',
  },
  kaynaklar: {
    heading: 'Kaynaklar',
    sectionDescription: 'Ana kaynak, önceki hal ve destekleyici belgeleri listele.',
    missingDataRule: 'NOTE',
  },
}
