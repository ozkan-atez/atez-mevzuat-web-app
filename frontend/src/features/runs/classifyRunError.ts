import type { ScanRunDetail } from '../scans/types'

export interface RunErrorPresentation { title: string; detail: string }

/** Treat persisted provider and validation messages as diagnostics, never UI copy. */
export function classifyRunError(run: ScanRunDetail): RunErrorPresentation {
  const topic = run.analysis?.topics.find((item) => item.errorCategory)
  if (topic) {
    const subject = topic.title.replace(/^\s*[–-]\s*/, '')
    if (topic.errorCategory === 'INVALID_RESPONSE') {
      const blankTable = /["']tables["']|tables\./i.test(topic.errorMessage ?? '') && /too_small|boş hücre/i.test(topic.errorMessage ?? '')
      return {
        title: 'Analiz verisi doğrulanamadı',
        detail: blankTable
          ? `${subject} belgesindeki boş tablo hücreleri hata sayılmış. Doğrulama kuralı düzeltildi; taramayı kaldığı yerden devam ettirin.`
          : `${subject} belgesinin analiz çıktısı beklenen biçimde değil. Yeniden deneyin.`,
      }
    }
    if (topic.errorCategory === 'RATE_LIMITED' || topic.errorCategory === 'QUOTA_EXCEEDED') {
      return { title: 'Yapay zekâ hizmeti sınırına ulaşıldı', detail: 'Analiz şu anda tamamlanamadı. Bir süre sonra yeniden deneyin.' }
    }
    if (topic.errorCategory === 'TIMEOUT' || topic.errorCategory === 'PROVIDER_UNAVAILABLE') {
      return { title: 'Yapay zekâ hizmetine erişilemedi', detail: 'Geçici bağlantı veya zaman aşımı sorunu oluştu. Yeniden deneyin.' }
    }
    if (topic.errorCategory === 'AUTHENTICATION' || topic.errorCategory === 'PERMISSION') {
      return { title: 'Yapay zekâ bağlantısı yapılandırılamadı', detail: 'Hizmet erişim ayarlarının kontrol edilmesi gerekiyor.' }
    }
    return { title: 'Belge analizi tamamlanamadı', detail: `${subject} belgesi işlenemedi. Kayıtları inceleyip yeniden deneyin.` }
  }
  if (run.currentStage === 'DISCOVERING') {
    return { title: 'Resmî Gazete kaynağına erişilemedi', detail: 'Resmî Gazete kaynağına erişilemedi. Bağlantı düzeldiğinde yeniden deneyin.' }
  }
  if (run.currentStage === 'AI_FILTERING' && run.filter?.errorCategory) {
    return { title: 'Belge filtreleme tamamlanamadı', detail: 'Yapay zekâ filtreleme yanıtı alınamadı veya doğrulanamadı. Yeniden deneyin.' }
  }
  if (run.currentStage === 'DISCOVERING_PREVIOUS_SOURCES') {
    return { title: 'Önceki kaynaklar hazırlanamadı', detail: 'Mevzuatın önceki kaynağına erişim veya doğrulama sırasında sorun oluştu.' }
  }
  if (run.currentStage === 'GENERATING_REPORTS') {
    return { title: 'Raporlama tamamlanamadı', detail: 'Bir rapor doğrulanamadı. Tamamlanan belgeler korunur; yeniden deneyin.' }
  }
  return { title: 'Tarama tamamlanamadı', detail: 'İşlem sırasında bir hata oluştu. Tamamlanan aşamalar korunur; yeniden deneyin.' }
}
