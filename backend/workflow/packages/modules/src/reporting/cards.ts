import type { AnalysisV1, DocumentProfileV1, ReportCard } from '@atez/contracts'

/**
 * Kart seçimi (§10): AI değil, analiz ve profil alanlarından kural.
 * Sıra önemlidir: kaldırma/uzatma/duyuru/değişiklik-yok türü, sayısal tablo varlığından önce gelir.
 */
export function selectCard(profile: DocumentProfileV1, analysis: AnalysisV1): ReportCard {
  const kind = profile.change.kind
  if (kind === 'REPEAL') return 'YURURLUKTEN_KALDIRMA'
  if (kind === 'EXTENSION') return 'SURE_UZATIMI'
  if (kind === 'NONE') return 'DEGISIKLIK_YOK'
  if (kind === 'ANNOUNCEMENT') return 'DUYURU'
  if (analysis.comparison.rows.some((r) => r.current?.value !== null && r.current?.value !== undefined)) return 'ORAN_TABLOSU'
  return 'YENI_DUZENLEME'
}

export const CARD_LABELS: Record<ReportCard, string> = {
  YENI_DUZENLEME: 'Yeni düzenleme',
  ORAN_TABLOSU: 'Oran / değer değişikliği',
  SURE_UZATIMI: 'Süre uzatımı',
  YURURLUKTEN_KALDIRMA: 'Yürürlükten kaldırma',
  DUYURU: 'Duyuru',
  DEGISIKLIK_YOK: 'Değişiklik yok',
}
