import type { AssistantKnowledge } from './assistant-knowledge'
import { normalizeTurkish, resolveTurkishDate } from './resolve-date'

/** A provider outage must not hide the automation's recorded failure. This path never writes. */
export async function answerWorkspaceQuery(content: string, knowledge: AssistantKnowledge): Promise<string | null> {
  const text = normalizeTurkish(content)
  if (/belge/.test(text) && /goster|listele|hangi|kayit|arsiv/.test(text) && !/analiz|baslat|calistir|ekle|olustur|degistir|duzenle|indir|cek/.test(text) && knowledge.searchArchiveDocuments) {
    const resolved = resolveTurkishDate(content)
    if (resolved && 'error' in resolved) return resolved.error
    const documents = await knowledge.searchArchiveDocuments({ ...(resolved ? { from: resolved.date, to: resolved.date } : {}), limit: 20 })
    if (!documents.length) return 'İstenen kapsamda arşivlenmiş belge bulunmuyor. Yeni tarama başlatılmadı.'
    return ['**Arşiv belgeleri**', ...documents.map(document => `- **${document.title}** · ${document.origin === 'SOURCE' ? 'Kaynak belgesi' : 'Kullanıcı belgesi'} · ${document.publishedOn ?? 'Yayın tarihi bilinmiyor'} · ${document.extractionStatus}\nSürüm: ${document.versionId} · [Arşivi aç](/documents)`)].join('\n\n')
  }
  if (!/otomasyon/.test(text) || /baslat|calistir|olustur|degistir|duzenle|sil\b/.test(text)) return null
  if (!knowledge.listAutomations) return null
  const resolved = resolveTurkishDate(content)
  if (resolved && 'error' in resolved) return resolved.error
  const rows = await knowledge.listAutomations({ ...(resolved ? { date: resolved.date } : {}), limit: 20 })
  if (!rows.length) return 'İstenen kapsamda otomasyon kaydı bulunamadı. Yeni bir işlem başlatılmadı.'
  return ['**Otomasyon kayıtları**', ...(resolved ? [`İstenen hedef tarih: ${resolved.date}`] : []), ...rows.map(row => {
    const lines = [`**${row.name}** · ${row.isActive ? 'Etkin' : 'Kapalı'} · ${row.times.join(', ') || 'Saat belirtilmemiş'} (${row.timezone})`]
    if (row.lastError) lines.push(`Zamanlama hatası: ${row.lastError}`)
    if (!row.runs.length) lines.push('Bu kapsamda kayıtlı çalışma yok. Bu kayıt tek başına neden çalışmadığını kanıtlamaz.')
    for (const run of row.runs) {
      lines.push(`${run.targetDate} · ${run.status} · [Çalışmayı aç](/runs/${run.runId})`)
      if (run.errorSummary) lines.push(`Çalışma hatası: ${run.errorSummary}`)
      for (const stage of run.stages) if (stage.error) lines.push(`${stage.source ? `${stage.source} / ` : ''}${stage.stage} (${stage.status}): ${stage.error}`)
    }
    for (const operation of row.operations ?? []) {
      lines.push(`Tek adım: ${operation.operation} · ${operation.status} · ${new Date(operation.createdAt).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })} tarihinde başlatıldı · [İşlemi aç](/operations/${operation.id})`)
      for (const task of operation.tasks) if (task.error) lines.push(`${task.stage} (${task.status}): ${task.error}`)
    }
    return lines.join('\n')
  })].join('\n\n')
}
