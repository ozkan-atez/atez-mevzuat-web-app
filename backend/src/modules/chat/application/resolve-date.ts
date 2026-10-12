import { DateTime } from 'luxon'

const months: Record<string, number> = { ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6, temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12 }
export function normalizeTurkish(text: string): string {
  return text.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i')
}

/** Omitted years resolve to the most recent calendar date; invalid dates never roll over. */
export function resolveTurkishDate(prompt: string, now = DateTime.now().setZone('Europe/Istanbul')): { date: string } | { error: string } | null {
  const text = normalizeTurkish(prompt)
  const numeric = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b|\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/)
  const named = text.match(/\b(\d{1,2})\s+(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)(?:\s+(\d{4}))?\b/)
  let year = now.year, month = now.month, day = now.day
  let omittedYear = false
  if (numeric) {
    year = Number(numeric[1] ?? numeric[6]); month = Number(numeric[2] ?? numeric[5]); day = Number(numeric[3] ?? numeric[4])
  } else if (named) {
    day = Number(named[1]); month = months[named[2]!]!; omittedYear = named[3] === undefined; year = Number(named[3] ?? now.year)
  } else if (/\bdun\w*/.test(text)) return { date: now.minus({ days: 1 }).toFormat('yyyy-MM-dd') }
  else if (/\bbugun\w*/.test(text)) return { date: now.toFormat('yyyy-MM-dd') }
  else return null
  let date = DateTime.fromObject({ year, month, day }, { zone: 'Europe/Istanbul' })
  if (omittedYear && date.isValid && date.toISODate()! > now.toISODate()!) date = DateTime.fromObject({ year: year - 1, month, day }, { zone: 'Europe/Istanbul' })
  return date.isValid ? { date: date.toFormat('yyyy-MM-dd') } : { error: 'Geçerli bir tarih belirtin (YYYY-AA-GG).' }
}
