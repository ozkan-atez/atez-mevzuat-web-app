import { createHash } from 'node:crypto'
import { DateTime } from 'luxon'

const MONTHS: Record<string, number> = {
  ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6,
  temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i')
}

/** Only an explicit request in the current user message can enable the write tool. */
export function requestedScanDate(message: string, now = DateTime.now().setZone('Europe/Istanbul')): string | null {
  const text = normalize(message)
  if (/\b(baslatma|calistirma)(?:yin|yiniz)?\b/.test(text)) return null
  if (!/\b(tarama|rapor|run)\w*\b/.test(text) || !/\b(baslat|calistir|olustur)\w*\b/.test(text)) return null

  const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)
  const numeric = text.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/)
  const named = text.match(/\b(\d{1,2})\s+(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)(?:['’]?[a-z]*)?(?:\s+(\d{4}))?\b/)
  const year = iso ? Number(iso[1]) : numeric ? Number(numeric[3]) : named?.[3] ? Number(named[3]) : now.year
  const month = iso ? Number(iso[2]) : numeric ? Number(numeric[2]) : named ? MONTHS[named[2]!] : 0
  const day = iso ? Number(iso[3]) : numeric ? Number(numeric[1]) : named ? Number(named[1]) : 0
  const date = DateTime.fromObject({ year, month, day }, { zone: 'Europe/Istanbul' })
  if (!date.isValid || date > now.startOf('day')) return null
  return date.toFormat('yyyy-MM-dd')
}

/** A retry of one tool call reuses the same manual run; a later message may start another. */
export function scanStartRequestKey(sessionId: string, messageId: string): string {
  const hex = createHash('sha256').update(`chat-scan:${sessionId}:${messageId}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
