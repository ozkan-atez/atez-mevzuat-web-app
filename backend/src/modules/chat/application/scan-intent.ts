import { DateTime } from 'luxon'

import { resolveTurkishDate } from './resolve-date'

export type ScanIntent = { targetDate: string } | { error: string } | null

/** Only an explicit request to perform a scan may create a run. */
export function parseScanIntent(prompt: string, now = DateTime.now().setZone('Europe/Istanbul')): ScanIntent {
  const text = prompt.toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u')
    .replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
  const mentionsScan = /\b(tarama\w*|tara|taran\w*)\b/.test(text)
  const mentionsDatedReport = /\b(rapor\w*|bulten\w*)\b/.test(text) &&
    /\b\d{1,2}\s+(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\b|\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/.test(text)
  if ((!mentionsScan && !mentionsDatedReport) ||
      !/\b(baslat\w*|calistir\w*|yap\w*|olustur\w*|gerceklestir\w*|hazirla\w*|cikar\w*)\b/.test(text) ||
      /\b(nasil|mumkun mu|yetkim|yetkisi|baslatabilir miyim|baslatabilirsiniz|baslatmali miyim|baslatma\b|baslatt\w* mi|baslatil\w* mi|olusturd\w* mu)\b/.test(text)) return null

  const resolved = resolveTurkishDate(prompt, now)
  if (resolved && 'error' in resolved) return { error: 'Geçerli bir tarama tarihi belirtin.' }
  if(!resolved)return {error:`Taramayı hangi tarih için başlatalım? Bugün (${now.toFormat('yyyy-MM-dd')}) için “bugün tarama başlat” yazabilirsiniz.`}
  return { targetDate: resolved.date }
}
