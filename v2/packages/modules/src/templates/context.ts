import type { AnalysisV1, DocumentProfileV1 } from '@atez/contracts'
import { formatDateTr } from '../reporting/numbers'

/**
 * Bileşenlerin veri bağı yaptığı render bağlamı. Analizdeki iç içe alanlar şablon yazarları ve
 * AI için düzleştirilir; katalog, doğrulamada "bağlanan alan gerçekten var mı?" sorusunun
 * cevabıdır.
 */
export interface RenderContext {
  analysis: {
    summary: string
    operationalImpact: string
    comparisonCommentary: string | null
    affected: { parties: string[]; sectors: string[] }
    exceptions: string[]
    claims: { text: string }[]
    comparison: { rows: ComparisonItem[]; note: string | null; notes: string[] }
    dates: { publication: string | null; effective: { scope: string | null; rule: string; date: string | null; label: string }[] }
    priorState: { status: string; statusLabel: string; comparisonDate: string | null; note: string | null }
    documents: { title: string; role: string; roleLabel: string; publicationDate: string | null; officialNumber: string | null; url: string | null }[]
  }
  document: {
    title: string
    officialNumber: string | null
    docType: string
    institution: string | null
    changeKind: string
    changeKindLabel: string
    publicationDate: string | null
    url: string | null
  }
}

export interface ComparisonItem {
  gtip: string
  description: string | null
  origin: string | null
  unit: string | null
  currency: string | null
  unitLabel: string
  previousValue: string | null
  currentValue: string | null
  changePct: string | null
  status: string
  statusLabel: string
  previousSource: string | null
  note: string | null
}

export type BindingType = 'string' | 'string[]' | 'date' | 'array'
export interface BindingInfo {
  path: string
  type: BindingType
  label: string
  /** Dizi bağları için satır alanları (göreli yol → tip). */
  item?: { path: string; type: 'string' | 'number' | 'percent' | 'date' | 'gtip'; label: string }[]
}

export const BINDING_CATALOG: BindingInfo[] = [
  { path: 'analysis.summary', type: 'string', label: 'Analiz özeti' },
  { path: 'analysis.operationalImpact', type: 'string', label: 'Operasyonel etki' },
  { path: 'analysis.comparisonCommentary', type: 'string', label: 'Karşılaştırma yorumu' },
  { path: 'analysis.affected.parties', type: 'string[]', label: 'Etkilenen taraflar' },
  { path: 'analysis.affected.sectors', type: 'string[]', label: 'Etkilenen sektörler' },
  { path: 'analysis.exceptions', type: 'string[]', label: 'İstisnalar ve belirsizlikler' },
  { path: 'analysis.claims', type: 'array', label: 'Kanıtlı iddialar', item: [{ path: 'text', type: 'string', label: 'İddia' }] },
  {
    path: 'analysis.comparison.rows',
    type: 'array',
    label: 'Karşılaştırma satırları (kodla hesaplanır)',
    item: [
      { path: 'gtip', type: 'gtip', label: 'GTİP' },
      { path: 'description', type: 'string', label: 'Eşya' },
      { path: 'origin', type: 'string', label: 'Menşe' },
      { path: 'unitLabel', type: 'string', label: 'Birim' },
      { path: 'previousValue', type: 'number', label: 'Önceki değer' },
      { path: 'currentValue', type: 'number', label: 'Yeni değer' },
      { path: 'changePct', type: 'percent', label: 'Değişim %' },
      { path: 'statusLabel', type: 'string', label: 'Durum' },
      { path: 'previousSource', type: 'string', label: 'Önceki değer kaynağı' },
    ],
  },
  { path: 'analysis.comparison.note', type: 'string', label: 'Karşılaştırma notu' },
  { path: 'analysis.comparison.notes', type: 'string[]', label: 'Satır notları' },
  { path: 'analysis.dates.publication', type: 'date', label: 'Yayım tarihi' },
  {
    path: 'analysis.dates.effective',
    type: 'array',
    label: 'Yürürlük tarihleri',
    item: [
      { path: 'date', type: 'date', label: 'Tarih' },
      { path: 'label', type: 'string', label: 'Açıklama' },
      { path: 'scope', type: 'string', label: 'Kapsam' },
    ],
  },
  { path: 'analysis.priorState.status', type: 'string', label: 'Önceki hal durumu (kod)' },
  { path: 'analysis.priorState.statusLabel', type: 'string', label: 'Önceki hal durumu' },
  { path: 'analysis.priorState.comparisonDate', type: 'date', label: 'Önceki hal tarihi' },
  { path: 'analysis.priorState.note', type: 'string', label: 'Önceki hal notu' },
  {
    path: 'analysis.documents',
    type: 'array',
    label: 'Kaynak belgeler',
    item: [
      { path: 'title', type: 'string', label: 'Başlık' },
      { path: 'roleLabel', type: 'string', label: 'Rol' },
      { path: 'publicationDate', type: 'date', label: 'Yayım' },
      { path: 'officialNumber', type: 'string', label: 'Numara' },
      { path: 'url', type: 'string', label: 'Bağlantı' },
    ],
  },
  { path: 'document.title', type: 'string', label: 'Düzenlemenin adı' },
  { path: 'document.officialNumber', type: 'string', label: 'Resmî numara' },
  { path: 'document.docType', type: 'string', label: 'Belge türü' },
  { path: 'document.institution', type: 'string', label: 'Kurum' },
  { path: 'document.changeKind', type: 'string', label: 'Değişiklik türü (kod)' },
  { path: 'document.changeKindLabel', type: 'string', label: 'Değişiklik türü' },
  { path: 'document.publicationDate', type: 'date', label: 'Yayım tarihi' },
  { path: 'document.url', type: 'string', label: 'Belge bağlantısı' },
]

export const bindingInfo = (path: string) => BINDING_CATALOG.find((b) => b.path === path)

const CHANGE_LABELS: Record<string, string> = {
  NEW: 'Yeni düzenleme',
  AMENDMENT: 'Değişiklik',
  REPEAL: 'Yürürlükten kaldırma',
  EXTENSION: 'Süre uzatımı',
  SUSPENSION: 'Askıya alma',
  ANNOUNCEMENT: 'Duyuru',
  NONE: 'Değişiklik yok',
}
const STATUS_LABELS: Record<string, string> = { CHANGED: 'Değişti', UNCHANGED: 'Değişmedi', NEW: 'Yeni önlem', REMOVED: 'Kaldırıldı', NO_PRIOR: 'Önceki değer yok' }
const PRIOR_LABELS: Record<string, string> = { FOUND: 'Önceki hal bulundu', PARTIAL: 'Önceki hal kısmen bulundu', AMBIGUOUS: 'Önceki hal belirsiz', SINGLE_SOURCE: 'Önceki hal bulunamadı (tek kaynak)', NOT_NEEDED: 'Önceki hal gerekmiyor' }
const ROLE_LABELS: Record<string, string> = { PRIMARY: 'Ana kaynak', PRIOR: 'Önceki hal', SUPPORTING: 'Destekleyici', SIGNAL: 'Sinyal' }
const RULE_LABELS: Record<string, string> = { ON_PUBLICATION: 'Yayımı tarihinde', EXPLICIT_DATE: 'Belirtilen tarihte', DAYS_AFTER_PUBLICATION: 'Yayımından sonra', UNRESOLVED: 'Belirsiz' }

export function buildRenderContext(analysis: AnalysisV1, profile: DocumentProfileV1): RenderContext {
  const primary = analysis.documents.find((d) => d.role === 'PRIMARY') ?? analysis.documents[0]
  const rows: ComparisonItem[] = analysis.comparison.rows.map((r) => ({
    gtip: r.gtip,
    description: r.description,
    origin: r.origin,
    unit: r.unit,
    currency: r.currency,
    unitLabel: [r.currency, unitTr(r.unit)].filter(Boolean).join(' / '),
    previousValue: r.previous?.value ?? null,
    currentValue: r.current?.value ?? null,
    changePct: r.changePct,
    status: r.status,
    statusLabel: STATUS_LABELS[r.status] ?? r.status,
    previousSource: r.previous?.source ?? null,
    note: r.previous?.note ?? null,
  }))
  return {
    analysis: {
      summary: analysis.summary,
      operationalImpact: analysis.operationalImpact,
      comparisonCommentary: analysis.comparisonCommentary,
      affected: analysis.affected,
      exceptions: analysis.exceptions,
      claims: analysis.claims.map((c) => ({ text: c.text })),
      comparison: { rows, note: analysis.comparison.note, notes: rows.filter((r) => r.note).map((r) => `${r.gtip}: ${r.note}`) },
      dates: {
        publication: analysis.dates.publication,
        effective: analysis.dates.effective.map((e) => ({ ...e, label: [RULE_LABELS[e.rule] ?? e.rule, e.scope].filter(Boolean).join(' · ') })),
      },
      priorState: { status: analysis.priorState.status, statusLabel: PRIOR_LABELS[analysis.priorState.status] ?? analysis.priorState.status, comparisonDate: analysis.priorState.comparisonDate, note: analysis.priorState.note },
      documents: analysis.documents.map((d) => ({ title: d.title, role: d.role, roleLabel: ROLE_LABELS[d.role] ?? d.role, publicationDate: d.publicationDate, officialNumber: d.officialNumber, url: d.url })),
    },
    document: {
      title: primary?.title ?? profile.identity.title,
      officialNumber: profile.identity.officialNumber,
      docType: profile.identity.docType,
      institution: profile.identity.institution,
      changeKind: profile.change.kind,
      changeKindLabel: CHANGE_LABELS[profile.change.kind] ?? profile.change.kind,
      publicationDate: profile.identity.publication.date,
      url: primary?.url ?? null,
    },
  }
}

function unitTr(u: string | null): string | null {
  if (!u) return null
  return ({ PCE: 'adet', TNE: 'ton', KGM: 'kg', PCT: '%', MTK: 'm²', LTR: 'litre', NPR: 'çift' } as Record<string, string>)[u] ?? u
}

/** Önizleme ve galeri için örnek bağlam (31.12.2025 gözetim örneğinden, sadeleştirilmiş). */
export const SAMPLE_CONTEXT: RenderContext = {
  analysis: {
    summary:
      'İthalatta gözetim uygulanan motorsuz bisikletler ve bisiklet kadrolarının birim gümrük kıymetleri yeniden belirlenmiştir. Bisikletlerde eşik 200 ABD Doları/adet’ten 300 ABD Doları/adet’e, kadrolarda 25’ten 35 ABD Doları/adet’e çıkmıştır.',
    operationalImpact: 'Eşiğin altında kalan beyanlar için Gözetim Belgesi alınması ya da kıymetin eşiğe yükseltilmesi gerekir.',
    comparisonCommentary: 'Bisikletlerde %50, kadrolarda %40 artış vardır.',
    affected: { parties: ['İthalatçılar', 'Gümrük müşavirleri'], sectors: ['Bisiklet', 'Spor ekipmanları'] },
    exceptions: ['Yolda olan eşya için geçiş hükmü bulunmamaktadır.'],
    claims: [{ text: 'Gözetim tablosu 2018/1 sayılı Tebliğin 1 inci maddesinde değiştirilmiştir.' }],
    comparison: {
      rows: [
        { gtip: '8712.00', description: 'Motorsuz bisikletler', origin: null, unit: 'PCE', currency: 'USD', unitLabel: 'USD / adet', previousValue: '200', currentValue: '300', changePct: '50.00', status: 'CHANGED', statusLabel: 'Değişti', previousSource: 'RG 2018/1', note: null },
        { gtip: '8714.91.10.00.11', description: 'Çelikten kadrolar', origin: null, unit: 'PCE', currency: 'USD', unitLabel: 'USD / adet', previousValue: '25', currentValue: '35', changePct: '40.00', status: 'CHANGED', statusLabel: 'Değişti', previousSource: 'TARIFF 30.12.2025', note: null },
      ],
      note: null,
      notes: [],
    },
    dates: { publication: '2025-12-31', effective: [{ scope: null, rule: 'DAYS_AFTER_PUBLICATION', date: '2026-01-30', label: 'Yayımından sonra' }] },
    priorState: { status: 'FOUND', statusLabel: 'Önceki hal bulundu', comparisonDate: '2025-12-30', note: null },
    documents: [
      { title: 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ (Tebliğ No: 2018/1)’de Değişiklik Yapılmasına Dair Tebliğ', role: 'PRIMARY', roleLabel: 'Ana kaynak', publicationDate: '2025-12-31', officialNumber: null, url: 'https://www.resmigazete.gov.tr/eskiler/2025/12/20251231M4-38.pdf' },
      { title: 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ (No: 2018/1)', role: 'PRIOR', roleLabel: 'Önceki hal', publicationDate: '2018-03-02', officialNumber: '2018/1', url: 'https://www.resmigazete.gov.tr/eskiler/2018/03/20180302-7.htm' },
    ],
  },
  document: {
    title: 'İthalatta Gözetim Uygulanmasına İlişkin Tebliğ (Tebliğ No: 2018/1)’de Değişiklik Yapılmasına Dair Tebliğ',
    officialNumber: null,
    docType: 'TEBLIG',
    institution: 'Ticaret Bakanlığı',
    changeKind: 'AMENDMENT',
    changeKindLabel: 'Değişiklik',
    publicationDate: '2025-12-31',
    url: 'https://www.resmigazete.gov.tr/eskiler/2025/12/20251231M4-38.pdf',
  },
}

export function getPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), root)
}

export const fmtDate = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDateTr(v) : v == null ? '' : String(v))
