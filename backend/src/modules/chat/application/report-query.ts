import { normalizeTurkish, resolveTurkishDate } from './resolve-date'
import { DateTime } from 'luxon'
import type { AssistantKnowledge } from './assistant-knowledge'

/** Known database queries stay available even when the model provider is down. */
export async function answerReportQuery(content: string, knowledge: AssistantKnowledge, now = DateTime.now().setZone('Europe/Istanbul')): Promise<string | null> {
  const text = normalizeTurkish(content)
  const reportsAsked = /rapor|bulten/.test(text)
  const scansAsked = /tarama/.test(text)
  if ((!reportsAsked && !scansAsked) || /duzenle|degistir|revize|sadelestir|olustur/.test(text)) return null
  const resolved = resolveTurkishDate(content, now)
  const latest = /\bson\b|\bguncel\b/.test(text)
  if (!resolved && !latest) return null
  if (resolved && 'error' in resolved) return resolved.error
  const date = resolved?.date
  const reports = reportsAsked ? await knowledge.searchReports({ ...(date ? { from: date, to: date } : {}), limit: 20 }) : []
  const lines = [reportsAsked ? (date ? `**${date} tarihli raporlar**` : '**Son yayımlanmış raporlar**') : (date ? `**${date} tarihli taramalar**` : '**Son taramalar**'), 'Bu yanıt sistemdeki kayıtlı rapor ve tarama verilerinden hazırlanmıştır.']
  if (reportsAsked && reports.length) {
    lines.push('', ...reports.map(report => `- **${report.title.replace(/^\s*(?:[-–—−•]\s*)+/u, '').trim()}** · ${report.gazetteDate} · r${report.version}\n${report.summary}\n[Bülteni aç](${report.reportUrl})`))
    if (reports.length === 20) lines.push('', 'En fazla 20 rapor gösteriliyor. Tam listeyi Raporlar sayfasından inceleyebilirsiniz.')
  } else if (reportsAsked) lines.push('', date ? 'Bu tarih için yayımlanmış bülten bulunmuyor.' : 'Henüz yayımlanmış bülten bulunmuyor.')
  if (date || scansAsked) {
    const runs = await knowledge.listScanRuns({ ...(date ? { date } : {}), limit: 10 })
    const labels: Record<string, string> = { COMPLETED: 'Tamamlandı', PARTIAL: 'Kısmen tamamlandı', AWAITING_RETRY: 'Yeniden deneme bekliyor', FAILED: 'Başarısız', QUEUED: 'Sırada', RUNNING: 'Çalışıyor', CANCELLED: 'İptal edildi' }
    if (runs.length) lines.push('', '**Tarama durumu**', ...runs.map(run => `- ${labels[run.status] ?? run.status} · ${run.documents} belge · ${run.relevantDocuments} ilgili belge · ${run.reports} rapor. [Taramayı incele](/runs/${run.runId})`))
    else lines.push('', 'İstenen dönem için kayıtlı tarama bulunmuyor; yeni bir tarama başlatılmadı.')
    if (reportsAsked && !reports.length && runs.length) lines.push('', runs.some(run => run.reports > 0) ? 'Tarama kayıtlarında rapor çıktısı bulunuyor. Bu çıktıları tarama ayrıntısından açabilirsiniz; eksik çıktı için tarama ayrıntısını inceleyebilirsiniz.' : 'Yayımlanmış bülten olmaması, mevzuat değişikliği olmadığı anlamına gelmez. Taramanın durumunu inceleyin.')
  }
  return lines.filter(Boolean).join('\n\n')
}
