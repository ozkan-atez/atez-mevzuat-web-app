import { randomUUID } from 'node:crypto'

export const templateComponents = [
  { key: 'heading', name: 'Başlık alanı', description: 'Rapor adı, tarih ve sayı', html: '<header style="padding:28px 36px;background:#1b2a4a;color:#fff"><p style="margin:0 0 8px;font-size:12px;letter-spacing:.12em">ATEZ MEVZUAT RADARI</p><h1 style="margin:0;font-size:25px">Günlük Mevzuat Bülteni</h1><p style="margin:8px 0 0;color:#cbd5e1">Tarih · Sayı</p></header>' },
  { key: 'summary', name: 'Yönetici özeti', description: 'Kısa karar ve etki özeti', html: '<section style="padding:22px;border:1px solid #dbe4f0;border-radius:12px;background:#f8fafc"><h2 style="margin:0 0 10px;font-size:18px">Yönetici özeti</h2><p style="margin:0">Günün önemli mevzuat değişiklikleri ve şirket operasyonlarına etkisi burada özetlenir.</p></section>' },
  { key: 'topic', name: 'Mevzuat kartı', description: 'Konu, değişiklik ve aksiyon', html: '<article style="padding:24px;border:1px solid #dbe4f0;border-radius:12px"><p style="margin:0 0 8px;color:#4f46e5;font-size:12px;font-weight:700">MEVZUAT DEĞİŞİKLİĞİ</p><h2 style="margin:0 0 12px;font-size:19px">Düzenleme başlığı</h2><p>Değişikliğin kapsamı ve uygulanacak işlem burada açıklanır.</p><p style="margin-bottom:0"><strong>Aksiyon:</strong> İlgili ekip değerlendirmesi.</p></article>' },
  { key: 'comparison', name: 'Önce / sonra', description: 'Değişen hükümleri karşılaştırır', html: '<section style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div style="padding:18px;background:#f1f5f9;border-radius:10px"><h2 style="margin:0 0 8px;font-size:16px">Önce</h2><p>Önceki düzenleme</p></div><div style="padding:18px;background:#eef2ff;border-radius:10px"><h2 style="margin:0 0 8px;font-size:16px">Sonra</h2><p>Yeni düzenleme</p></div></section>' },
  { key: 'table', name: 'Veri tablosu', description: 'Satır ve sütunlu karşılaştırma', html: '<section><h2 style="font-size:18px">Karşılaştırma tablosu</h2><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#1b2a4a;color:white"><th style="padding:10px;text-align:left">Başlık</th><th style="padding:10px;text-align:left">Açıklama</th></tr></thead><tbody><tr><td style="padding:10px;border-bottom:1px solid #e2e8f0">Kalem</td><td style="padding:10px;border-bottom:1px solid #e2e8f0">Değer</td></tr></tbody></table></section>' },
  { key: 'deadline', name: 'Yürürlük ve süre', description: 'Tarih, süre ve sorumlu ekip', html: '<aside style="padding:20px;border-left:4px solid #f59e0b;background:#fffbeb"><h2 style="margin:0 0 8px;font-size:17px">Yürürlük ve süre</h2><p style="margin:0">Yürürlük tarihi · Son işlem tarihi · Sorumlu ekip</p></aside>' },
  { key: 'source', name: 'Kaynak bağlantısı', description: 'Resmî metne bağlantı', html: '<section style="padding:16px;border-top:1px solid #e2e8f0"><strong>Kaynak:</strong> <a href="https://www.resmigazete.gov.tr/" style="color:#1d4ed8">T.C. Resmî Gazete</a><p style="color:#64748b;font-size:12px">Yayımlanan asıl metin esas alınır.</p></section>' },
  { key: 'no-change', name: 'Değişiklik yok', description: 'Kapsam içi tespit bulunmayan gün', html: '<section style="padding:24px;border:1px solid #dbe4f0;border-radius:12px"><h2 style="margin:0 0 8px;font-size:18px">Kapsam içi değişiklik yok</h2><p style="margin:0">İncelenen kaynaklarda raporlanabilir gümrük veya dış ticaret değişikliği bulunmadı.</p></section>' },
] as const

export type TemplateComponentKey = typeof templateComponents[number]['key']
export const templatePresets = [
  { key: 'executive', name: 'Yönetici bülteni', description: 'Özet, aksiyon ve kaynak', components: ['heading', 'summary', 'topic', 'source'] },
  { key: 'detailed', name: 'Ayrıntılı analiz', description: 'Karşılaştırma, tablo ve süreler', components: ['heading', 'summary', 'topic', 'comparison', 'table', 'deadline', 'source'] },
  { key: 'empty-day', name: 'Değişiklik yok', description: 'Kısa günlük durum raporu', components: ['heading', 'no-change', 'source'] },
] as const

export function templateBaseHtml(): string {
  return '<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ATEZ Mevzuat Bülteni</title><style>body{margin:0;background:#f5f7fa;color:#1a2436;font:14px/1.6 Arial,sans-serif}main{max-width:760px;min-height:100vh;margin:auto;background:#fff;padding-bottom:32px}.atez-components{display:grid;gap:18px;padding:28px 36px}a{color:#1d4ed8}@media(max-width:600px){.atez-components{padding:20px}section[style*="grid-template-columns"]{display:block!important}}</style></head><body><main><div class="atez-components"><!-- ATEZ_COMPONENTS --></div></main></body></html>'
}

export function insertTemplateComponent(html: string, key: string): string {
  const component = templateComponents.find((item) => item.key === key)
  if (!component) throw new Error('Bilinmeyen şablon bileşeni.')
  const block = `<!-- ATEZ_COMPONENT:${component.key}:${randomUUID()} -->${component.html}<!-- /ATEZ_COMPONENT -->`
  if (html.includes('<!-- ATEZ_COMPONENTS -->')) return html.replace('<!-- ATEZ_COMPONENTS -->', `${block}\n<!-- ATEZ_COMPONENTS -->`)
  const close = /<\/main\s*>/i.test(html) ? /<\/main\s*>/i : /<\/body\s*>/i
  return close.test(html) ? html.replace(close, `${block}\n$&`) : `${html}\n${block}`
}

export function buildPresetHtml(key: string): string {
  const preset = templatePresets.find((item) => item.key === key)
  if (!preset) throw new Error('Bilinmeyen hazır şablon.')
  return preset.components.reduce((html, component) => insertTemplateComponent(html, component), templateBaseHtml())
}

export function validateTemplateHtml(html: string): void {
  if (html.length > 500_000 || !/<html\b/i.test(html) || !/<body\b/i.test(html)) throw new Error('Tam bir HTML belge gereklidir (en fazla 500 KB).')
  if (/<\s*(script|iframe|object|embed|form|base)\b/i.test(html) || /\bon[a-z]+\s*=/i.test(html) || /javascript\s*:/i.test(html)) {
    throw new Error('Şablonda çalıştırılabilir kod veya gömülü sayfa bulunamaz.')
  }
}
