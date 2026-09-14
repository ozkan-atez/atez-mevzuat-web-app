import { ALLOWED_CSS_CLASSES } from '../templates/bulten-v2'

export interface ReportValidationExpectation {
  card: 'K1' | 'K2' | 'K3' | 'K4' | 'K5' | 'K6'
  topicId: string | null
  basename: string
}

export function validateReportHtml(html: string, expected: ReportValidationExpectation): void {
  const errors: string[] = []
  const body = html.replace(/<style>[\s\S]*?<\/style>/i, '').replace(/data:image\/[^"'\s]+/g, '')
  if (!html.trim()) errors.push('HTML boş.')
  if (/\{\{[^}]+\}\}|<!--\s*ATEZ:/i.test(html)) errors.push('Çözülmemiş şablon alanı var.')
  if (!/src="data:image\/png;base64,/.test(html)) errors.push('Gömülü PNG logo eksik.')
  if (/<(?:script|link|iframe|form|object|embed)\b/i.test(html) || /\son[a-z]+\s*=|\sstyle\s*=|javascript:/i.test(html)) errors.push('Yasaklı HTML etiketi veya niteliği var.')
  if (/<img\b[^>]*\bsrc=["']https?:/i.test(html)) errors.push('Harici görsel var.')
  if (/(?:doğrulanamadı|teyit edilemedi|güvensiz|emin değiliz|kesin değil|belirsiz|muhtemelen|sanıyoruz|şüpheli|garanti edilemez)/i.test(body)) errors.push('Belirsizlik ifadesi var.')
  if (!html.includes('<meta name="x-atez-template" content="bulten-v2">') || !html.includes('class="topbar"') || !html.includes('class="header"') || !html.includes('class="fine"') || !html.includes('class="footer"')) errors.push('Sabit iskelet eksik.')
  if (!/<\/header>\s*<section class="feed">/.test(html) || /class="(?:overview|stats|stat|section-heading)"/.test(html)) errors.push('Feed yerleşimi geçersiz.')
  const cards = html.match(/<article class="card(?: [^"]+)?">/g) ?? []
  if (cards.length !== 1) errors.push(`Tam olarak bir kart gerekli; bulunan ${cards.length}.`)
  if (/(?:Öncelik|Etkilenen Sektör|Sınırlamalar|Kanıt Konumu|Senaryo\s+[A-Z]|MOD:)/i.test(body)) errors.push('Müşteri dışı süreç alanı var.')
  if (expected.card === 'K6' ? expected.basename !== '00-degisiklik-yok.html' : !/^\d{2}-[a-z0-9-]+\.html$/.test(expected.basename)) errors.push('Dosya adı geçersiz.')
  if (expected.card === 'K6' && expected.topicId !== null) errors.push('K6 topic kimliği taşımamalı.')
  if (expected.card !== 'K6' && (!expected.topicId || !html.includes(`content="${expected.topicId}"`))) errors.push('Topic meta alanı eşleşmiyor.')
  for (const match of html.matchAll(/class="([^"]+)"/g)) for (const name of match[1]!.split(/\s+/)) if (!ALLOWED_CSS_CLASSES.has(name)) errors.push(`Katalog dışı CSS sınıfı: ${name}`)
  if (/<(?:p|li|td)>\s*(?:|—|-|UYGULANMAZ|N\/A|değerlendirilmektedir|takip edilecektir)\s*<\//i.test(body)) errors.push('Boş veya dolgu blok var.')
  const noteCount = (body.match(/<aside class="note(?: note--alert)?">/g) ?? []).length
  if (noteCount > 2) errors.push('İkiden fazla not bloğu var.')
  if ((body.match(/<section class="block"><h2>Kimleri etkiliyor\?<\/h2>[\s\S]*?<\/section>/g)?.[0]?.match(/<li>/g) ?? []).length > 3) errors.push('Etkilenenler sınırı aşıldı.')
  if ((body.match(/<div class="timeline-row">/g) ?? []).length > 3) errors.push('Takvim sınırı aşıldı.')
  const tableColumns = (body.match(/<th>/g) ?? []).length
  if ((tableColumns >= 5) !== body.includes('data-table--wide') && tableColumns > 0) errors.push('Geniş tablo sınıfı hatalı.')
  const card = body.match(/<article class="card(?: [^"]+)?">([\s\S]*?)<\/article>/)?.[1]
  if (!card || !/<div class="source">[\s\S]*href="https?:\/\/[^"]+"[\s\S]*<\/div>\s*$/.test(card)) errors.push('Kartın son kaynak satırı eksik.')
  if (errors.length) throw new Error(`BLOCKED_AUDIT: ${errors.join(' ')}`)
}
