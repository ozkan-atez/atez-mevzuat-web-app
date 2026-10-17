import type { ComponentCategory, ComponentDefinition } from '@atez/contracts'

export interface BuiltinComponent {
  key: string
  name: string
  description: string
  category: ComponentCategory
  definition: ComponentDefinition
}

const def = (d: Omit<ComponentDefinition, 'schemaVersion' | 'bindings'>): ComponentDefinition => ({ schemaVersion: 1, bindings: [], ...d })

/**
 * Yerleşik bileşenler: bugünkü bulten-v2 kartları (K1–K6) ve blokları. "Kart türü" artık her
 * bileşenin görünme kuralıdır (appliesWhen).
 */
export const BUILTIN_COMPONENTS: BuiltinComponent[] = [
  {
    key: 'ozet',
    name: 'Özet',
    description: 'Raporun girişi: ne yayımlandı, ne değişti, ne zaman yürürlüğe giriyor. Her raporda kullanılır.',
    category: 'OZET',
    definition: def({
      nodes: [
        { type: 'badge', bind: 'document.changeKindLabel' },
        { type: 'text', slot: 'lead', classes: ['lead'] },
      ],
      slots: [{ key: 'lead', kind: 'text', instruction: '2–3 cümlelik giriş: ne yayımlandı, ne değişti, ne zaman yürürlüğe giriyor.' }],
      appliesWhen: '',
      sampleData: { slots: { lead: 'Bisiklet ve kadro ithalatında gözetim eşikleri yükseltildi; düzenleme 30.01.2026’da yürürlüğe giriyor.' } },
    }),
  },
  {
    key: 'onemli-noktalar',
    name: 'Öne çıkanlar',
    description: 'Değişikliğin 3–6 maddelik özeti.',
    category: 'OZET',
    definition: def({
      nodes: [{ type: 'list', slot: 'keyPoints' }],
      slots: [{ key: 'keyPoints', kind: 'list', instruction: '3–6 madde; her biri tek cümle, analizdeki bilgiye dayalı.' }],
      appliesWhen: '',
      sampleData: { slots: { keyPoints: ['Bisiklet eşiği 300 ABD Doları/adet oldu.', 'Kadrolarda eşik 35 ABD Doları/adet oldu.'] } },
    }),
  },
  {
    key: 'yeni-duzenleme',
    name: 'Değişiklik kartı (yeni düzenleme / değişiklik)',
    description: 'K1: düzenlemenin kimliği ve neyi değiştirdiği. Yeni düzenleme ve değişikliklerde görünür.',
    category: 'DEGISIKLIK_KARTI',
    definition: def({
      nodes: [
        {
          type: 'metadata',
          rows: [
            { label: 'Düzenleme', bind: 'document.title', format: 'text' },
            { label: 'Kurum', bind: 'document.institution', format: 'text' },
            { label: 'Yayım', bind: 'document.publicationDate', format: 'date' },
          ],
        },
        { type: 'text', slot: 'change' },
      ],
      slots: [{ key: 'change', kind: 'text', instruction: 'Düzenlemenin neyi getirdiği ya da neyi değiştirdiği; 2–4 cümle.' }],
      appliesWhen: "document.changeKind == 'NEW' || document.changeKind == 'AMENDMENT'",
      sampleData: { slots: { change: '2018/1 sayılı Tebliğ’in gözetim tablosu değiştirilerek birim kıymet eşikleri yükseltildi.' } },
    }),
  },
  {
    key: 'karsilastirma-tablosu',
    name: 'Karşılaştırma tablosu (oran/değer)',
    description: 'K2: önceki ve yeni değerler, değişim yüzdesi. Değerler ve yüzdeler kodla hesaplanır.',
    category: 'KARSILASTIRMA_TABLOSU',
    definition: def({
      nodes: [
        { type: 'text', slot: 'tableIntro', classes: ['table-intro'] },
        {
          type: 'table',
          bind: 'analysis.comparison.rows',
          classes: ['data-table--wide'],
          columns: [
            { header: 'GTİP', value: 'gtip', format: 'gtip' },
            { header: 'Eşya', value: 'description', format: 'text' },
            { header: 'Menşe', value: 'origin', format: 'text' },
            { header: 'Birim', value: 'unitLabel', format: 'text' },
            { header: 'Önceki', value: 'previousValue', format: 'number' },
            { header: 'Yeni', value: 'currentValue', format: 'number' },
            { header: 'Değişim', value: 'changePct', format: 'percent' },
            { header: 'Durum', value: 'statusLabel', format: 'text' },
          ],
        },
        { type: 'list', bind: 'analysis.comparison.notes', classes: ['table-notes'] },
      ],
      slots: [{ key: 'tableIntro', kind: 'text', instruction: 'Tabloyu tanıtan tek cümle; tablodaki sayıları tekrar etme.' }],
      appliesWhen: "size(analysis.comparison.rows) > 0 && (analysis.priorState.status == 'FOUND' || analysis.priorState.status == 'PARTIAL')",
      sampleData: { slots: { tableIntro: 'Önceki değerler TARIFF ve 2018/1 sayılı Tebliğ’den alınmıştır.' } },
    }),
  },
  {
    key: 'gtip-tablosu',
    name: 'GTİP tablosu (önceki hal yok)',
    description: 'Önceki hal bulunamadığında yalnızca yeni değerleri listeler.',
    category: 'GTIP_TABLOSU',
    definition: def({
      nodes: [
        {
          type: 'table',
          bind: 'analysis.comparison.rows',
          columns: [
            { header: 'GTİP', value: 'gtip', format: 'gtip' },
            { header: 'Eşya', value: 'description', format: 'text' },
            { header: 'Birim', value: 'unitLabel', format: 'text' },
            { header: 'Değer', value: 'currentValue', format: 'number' },
          ],
        },
      ],
      slots: [],
      appliesWhen: "size(analysis.comparison.rows) > 0 && analysis.priorState.status != 'FOUND' && analysis.priorState.status != 'PARTIAL'",
      sampleData: { slots: {} },
    }),
  },
  {
    key: 'yururluk',
    name: 'Yürürlük ve tarihler',
    description: 'Yayım, önceki hal ve yürürlük tarihleri ayrı ayrı.',
    category: 'ZAMAN_CIZELGESI',
    definition: def({
      nodes: [
        {
          type: 'metadata',
          rows: [
            { label: 'Yayım tarihi', bind: 'analysis.dates.publication', format: 'date' },
            { label: 'Önceki hal tarihi', bind: 'analysis.priorState.comparisonDate', format: 'date' },
          ],
        },
        { type: 'timeline', bind: 'analysis.dates.effective', date: 'date', itemText: 'label' },
      ],
      slots: [],
      appliesWhen: 'size(analysis.dates.effective) > 0',
      sampleData: { slots: {} },
    }),
  },
  {
    key: 'sure-uzatimi',
    name: 'Süre uzatımı',
    description: 'K3: eski ve yeni süre yan yana.',
    category: 'DEGISIKLIK_KARTI',
    definition: def({
      nodes: [{ type: 'compare', before: { label: 'Önceki süre', slot: 'before' }, after: { label: 'Yeni süre', slot: 'after' } }],
      slots: [
        { key: 'before', kind: 'text', instruction: 'Uzatılmadan önceki süre ya da bitiş tarihi (analizden).' },
        { key: 'after', kind: 'text', instruction: 'Uzatılan yeni süre ya da bitiş tarihi (analizden).' },
      ],
      appliesWhen: "document.changeKind == 'EXTENSION'",
      sampleData: { slots: { before: '31.12.2025', after: '31.12.2026' } },
    }),
  },
  {
    key: 'yururlukten-kaldirma',
    name: 'Yürürlükten kaldırma',
    description: 'K4: kaldırılan düzenleme ve etkisi.',
    category: 'NOT_UYARI',
    definition: def({
      nodes: [{ type: 'note', variant: 'alert', label: 'Yürürlükten kaldırıldı', slot: 'repeal' }],
      slots: [{ key: 'repeal', kind: 'text', instruction: 'Hangi düzenlemenin/maddenin kaldırıldığı ve uygulamadaki sonucu.' }],
      appliesWhen: "document.changeKind == 'REPEAL'",
      sampleData: { slots: { repeal: '2012/6 sayılı Tebliğ yürürlükten kaldırılmıştır.' } },
    }),
  },
  {
    key: 'duyuru',
    name: 'Duyuru',
    description: 'K5: kurum duyurusu ya da bilgilendirme.',
    category: 'NOT_UYARI',
    definition: def({
      nodes: [{ type: 'container', classes: ['info-box'], children: [{ type: 'heading', level: 3, text: 'Duyuru' }, { type: 'text', slot: 'announcement' }] }],
      slots: [{ key: 'announcement', kind: 'text', instruction: 'Duyurunun özü ve ilgilileri; 2–3 cümle.' }],
      appliesWhen: "document.changeKind == 'ANNOUNCEMENT'",
      sampleData: { slots: { announcement: 'Ticaret Bakanlığı elektronik başvuru sistemine ilişkin güncelleme duyurdu.' } },
    }),
  },
  {
    key: 'degisiklik-yok',
    name: 'Değişiklik yok',
    description: 'K6: gündemde ilgili bir değişiklik olmadığında.',
    category: 'NOT_UYARI',
    definition: def({
      nodes: [{ type: 'container', classes: ['empty-state'], children: [{ type: 'text', slot: 'noChange' }] }],
      slots: [{ key: 'noChange', kind: 'text', instruction: 'İlgili bir değişiklik olmadığını kısa ve net söyle.' }],
      appliesWhen: "document.changeKind == 'NONE'",
      sampleData: { slots: { noChange: 'Bugünkü yayımlarda gümrük ve dış ticareti etkileyen bir değişiklik bulunmamaktadır.' } },
    }),
  },
  {
    key: 'etkilenenler',
    name: 'Etkilenenler ve pratik etki',
    description: 'Etkilenen taraflar, sektörler ve firmalara pratik etki.',
    category: 'ETKILENENLER',
    definition: def({
      nodes: [
        { type: 'text', slot: 'impact' },
        { type: 'container', classes: ['grid-2'], children: [{ type: 'list', label: 'Taraflar', bind: 'analysis.affected.parties' }, { type: 'list', label: 'Sektörler', bind: 'analysis.affected.sectors' }] },
      ],
      slots: [{ key: 'impact', kind: 'text', instruction: 'Firmalar için pratik etki; tek paragraf.' }],
      appliesWhen: '',
      sampleData: { slots: { impact: 'Eşiğin altında kalan beyanlarda Gözetim Belgesi gerekecek.' } },
    }),
  },
  {
    key: 'onceki-hal-uyarisi',
    name: 'Önceki hal uyarısı',
    description: 'Önceki hal bulunamadığında ya da belirsiz olduğunda uyarı.',
    category: 'NOT_UYARI',
    definition: def({
      nodes: [{ type: 'note', label: 'Önceki hal', bind: 'analysis.priorState.statusLabel' }],
      slots: [],
      appliesWhen: "analysis.priorState.status == 'SINGLE_SOURCE' || analysis.priorState.status == 'AMBIGUOUS'",
      sampleData: { slots: {} },
    }),
  },
  {
    key: 'istisnalar',
    name: 'İstisnalar ve belirsizlikler',
    description: 'Geçiş hükümleri, istisnalar ve belirsiz noktalar.',
    category: 'NOT_UYARI',
    definition: def({
      nodes: [{ type: 'list', bind: 'analysis.exceptions' }],
      slots: [],
      appliesWhen: 'size(analysis.exceptions) > 0',
      sampleData: { slots: {} },
    }),
  },
  {
    key: 'kaynaklar',
    name: 'Kaynaklar',
    description: 'Ana kaynak, önceki hal ve destekleyici belgeler.',
    category: 'KAYNAKLAR',
    definition: def({
      nodes: [{ type: 'sources', bind: 'analysis.documents' }],
      slots: [],
      appliesWhen: 'size(analysis.documents) > 0',
      sampleData: { slots: {} },
    }),
  },
]
