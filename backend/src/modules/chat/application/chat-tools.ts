import type { AssistantKnowledge } from './assistant-knowledge'

export interface ChatToolDeclaration {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ChatToolContext {
  authorizedRun?: { targetDate: string; requestKey: string } | undefined
  startRun?: ((input: { targetDate: string; requestKey: string }) => Promise<{ id: string; status: string; targetDate: string }>) | undefined
  authorizedTemplate?: boolean
  createTemplate?: ((input: { request: string; preset: 'executive' | 'detailed' | 'empty-day' }) => Promise<{ id: string; name: string }>) | undefined
  listTemplates?: (() => Promise<Array<{ id: string; name: string; description: string | null }>>) | undefined
}

const isoDate = { type: 'string', description: 'YYYY-AA-GG biçiminde tarih.' } as const

/**
 * What the assistant may ask the platform for.
 *
 * Declared in Turkish because the questions are: the model picks a tool from the
 * user's own wording, and a Turkish name and description make that choice far
 * more reliable than a translated one.
 */
export const CHAT_TOOLS: ChatToolDeclaration[] = [
  {
    name: 'rapor_sablonlarini_listele', description: 'Kayıtlı rapor şablonu taslaklarının adlarını ve düzenleme bağlantılarını listeler.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'rapor_sablonu_taslagi_olustur', description: 'Kullanıcı açıkça yeni bir rapor şablonu hazırlamayı istediğinde AI ile düzenlenebilir TASLAK oluşturur. Yayımlamaz ve otomatik bülten şablonunu değiştirmez. Aynı mesajda yalnızca bir kez çağır.',
    parameters: { type: 'object', properties: { istek: { type: 'string', description: 'Şablonun tasarım, bileşen ve içerik düzeni isteği.' }, hazirDuzen: { type: 'string', enum: ['executive', 'detailed', 'empty-day'], description: 'Başlangıç düzeni.' } }, required: ['istek'] },
  },
  {
    name: 'tarihli_tarama_baslat',
    description: 'Kullanıcı açıkça belirli bir tarih için yeni tarama/rapor oluşturma işlemini başlatmayı istediğinde manuel taramayı kuyruğa alır. Bu araç yalnızca işi başlatır; rapor hemen hazır olmaz. Tarih YYYY-AA-GG olmalı; mevcut raporu yalnızca görmek için kullanma.',
    parameters: { type: 'object', properties: { tarih: isoDate }, required: ['tarih'] },
  },
  {
    name: 'eklenen_kaynaklari_ara',
    description: 'Kullanıcının Kaynaklar sayfasına eklediği etkin bağlantıları başlık, açıklama ve içeriklerinde arar. Mevzuat veya bir kaynak hakkında sorularda bu aracı kullan; bağlantılar destekleyici bilgidir.',
    parameters: { type: 'object', properties: { sorgu: { type: 'string', description: 'Kaynakta aranacak ifade. Boşsa son eklenen kaynaklar döner.' }, limit: { type: 'integer' } } },
  },
  {
    name: 'eklenen_kaynagi_getir',
    description: 'Kaynaklar sayfasına eklenmiş bir bağlantının okunmuş içeriğini ve kaynak URL’sini getirir. Önce eklenen_kaynaklari_ara ile kimliği bulun.',
    parameters: { type: 'object', properties: { kaynakId: { type: 'string' } }, required: ['kaynakId'] },
  },
  {
    name: 'raporlari_ara',
    description: 'Yayımlanmış ATEZ mevzuat bültenlerini arar. Başlık ve özet metninde geçen kelimelere, istenirse gazete tarih aralığına göre filtreler. Hangi konuda rapor çıktığını bulmak için ilk başvurulacak araçtır.',
    parameters: {
      type: 'object',
      properties: {
        sorgu: { type: 'string', description: 'Aranacak kelimeler, örneğin "ithalat tebliği" veya "döviz kuru". Boş bırakılırsa en yeni raporlar döner.' },
        baslangicTarihi: isoDate,
        bitisTarihi: isoDate,
        limit: { type: 'integer', description: 'En fazla kaç rapor dönsün (varsayılan 10, en çok 25).' },
      },
    },
  },
  {
    name: 'rapor_getir',
    description: 'Rapor kimliği veya konu kimliği ile yayımlanmış bülteni ve varsa onay bekleyen taslağı ayrı ayrı getirir. Değişiklik yok raporu için reportId kullanın.',
    parameters: {
      type: 'object',
      properties: {
        topicId: { type: 'string', description: 'Raporun ait olduğu konunun kimliği (UUID).' },
        reportId: { type: 'string', description: 'Raporun kimliği; değişiklik yok raporlarında zorunludur.' },
        surum: { type: 'integer', description: 'İstenen revizyon numarası; boş bırakılırsa en güncel revizyon döner.' },
      },
    },
  },
  {
    name: 'gunluk_raporlari_getir', description: 'İstenen takvim tarihinde oluşturulan tüm taramaların raporlarını, değişiklik yok bülteni dahil, ayrı ayrı listeler.',
    parameters: { type: 'object', properties: { tarih: isoDate }, required: ['tarih'] },
  },
  {
    name: 'rapor_dosyalari_getir', description: 'Raporun belirtilen yayımlanmış sürümü için HTML ve indirilebilir PDF bağlantılarını getirir. Önce rapor veya gün raporları aracından kimliği bulun.',
    parameters: { type: 'object', properties: { topicId: { type: 'string' }, reportId: { type: 'string' }, surum: { type: 'integer' } } },
  },
  {
    name: 'revizyon_gecmisi_getir', description: 'Bir raporun yayımlanmış sürümlerinin ve ona bağlı analiz revizyonlarının tarihli geçmişini listeler.',
    parameters: { type: 'object', properties: { topicId: { type: 'string' }, reportId: { type: 'string' } } },
  },
  {
    name: 'taslak_degisiklikleri_getir', description: 'Henüz onaylanmamış rapor değişikliklerini, önceki/yeni değerleri ve geri alma durumlarını gösterir.',
    parameters: { type: 'object', properties: { topicId: { type: 'string' }, reportId: { type: 'string' } } },
  },
  {
    name: 'belge_baglantilari_getir', description: 'Bir arşiv belgesinin filtre kararını, eklerini, önceki kaynaklarını, analizlerini ve raporlarını izler.',
    parameters: { type: 'object', properties: { belgeId: { type: 'string' } }, required: ['belgeId'] },
  },
  {
    name: 'tarama_adimlari_getir', description: 'Bir taramanın aşama durumlarını, hatalarını ve başarısız indirme denemelerini getirir.',
    parameters: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] },
  },
  {
    name: 'resmi_gazete_ara', description: 'Belgeyi önce yerel arşivde, bulunmazsa Resmî Gazete aramasında bulur. Birden fazla sonuç varsa kullanıcıya seçenekleri göster.',
    parameters: { type: 'object', properties: { sorgu: { type: 'string' }, bitisTarihi: isoDate, limit: { type: 'integer' } }, required: ['sorgu'] },
  },
  {
    name: 'resmi_gazete_belge_getir', description: 'Arama sonucundan seçilen tek bir doğrulanmış Resmî Gazete bağlantısını okur ve ayrı önbelleğe kaydeder; tarama veya rapor üretmez.',
    parameters: { type: 'object', properties: { kaynakUrl: { type: 'string' }, baslik: { type: 'string', description: 'Arama sonucundaki belge başlığı; fihrist bağlantısında gereklidir.' }, tarih: isoDate }, required: ['kaynakUrl'] },
  },
  {
    name: 'analiz_getir',
    description: 'Bir konunun yapay zekâ analiz çıktısını getirir. Bültene girmeyen ayrıntılar (kanıt referansları, karşılaştırmalar, çözülemeyen atıflar) burada bulunur.',
    parameters: {
      type: 'object',
      properties: {
        topicId: { type: 'string', description: 'Konu kimliği (UUID).' },
        surum: { type: 'integer', description: 'Analiz revizyon numarası; boş bırakılırsa en güncel analiz döner.' },
      },
      required: ['topicId'],
    },
  },
  {
    name: 'belgeleri_ara',
    description: 'Toplanan Resmî Gazete belgelerini arar; rapora dönüşmemiş belgeler de dahildir. Belirli bir günde ne yayımlandığını veya bir belgenin taranıp taranmadığını öğrenmek için kullanın.',
    parameters: {
      type: 'object',
      properties: {
        sorgu: { type: 'string', description: 'Belge başlığında aranacak kelimeler.' },
        baslangicTarihi: isoDate,
        bitisTarihi: isoDate,
        sadeceIlgili: { type: 'boolean', description: 'true ise yalnızca gümrük/dış ticaret filtresinden geçen belgeler döner.' },
        limit: { type: 'integer', description: 'En fazla kaç belge dönsün (varsayılan 20, en çok 50).' },
      },
    },
  },
  {
    name: 'belge_metni_getir',
    description: 'Toplanan bir Resmî Gazete belgesinin arşivlenmiş tam metnini getirir. Belge PDF ise metin çıkarılmaz; bu durumda analiz veya rapor içeriğini kullanın.',
    parameters: {
      type: 'object',
      properties: { belgeId: { type: 'string', description: 'belgeleri_ara sonucundaki documentId değeri.' } },
      required: ['belgeId'],
    },
  },
  {
    name: 'taramalari_listele',
    description: 'Günlük tarama çalıştırmalarını durumlarıyla listeler: hangi gün çalıştı, hangi aşamada, kaç belge işlendi, kaç rapor üretildi, hata var mı.',
    parameters: {
      type: 'object',
      properties: {
        tarih: { ...isoDate, description: 'Yalnızca bu hedef tarihe ait taramalar. Boş bırakılırsa en yeni taramalar döner.' },
        limit: { type: 'integer', description: 'En fazla kaç tarama dönsün (varsayılan 10, en çok 30).' },
      },
    },
  },
  {
    name: 'tarama_icerigi_getir',
    description: 'Tek bir taramanın rapor bağlantılarını ve gümrük/dış ticaret filtresinden geçen Resmî Gazete belgelerinin doğrudan kaynak bağlantılarını getirir. “Bu run” veya “bu tarama” sorularında önceki konuşmada verilen runId değerini kullanın. Filtre sonucu boşsa bunu açıkça belirtin.',
    parameters: {
      type: 'object',
      properties: { runId: { type: 'string', description: 'Tarama çalıştırmasının UUID kimliği. Önceki mesajda yoksa taramalari_listele ile bulun.' } },
      required: ['runId'],
    },
  },
  {
    name: 'onceki_kaynaklari_listele',
    description: 'Bir konunun değiştirdiği veya atıfta bulunduğu önceki mevzuat belgelerini listeler.',
    parameters: {
      type: 'object',
      properties: { topicId: { type: 'string', description: 'Konu kimliği (UUID).' } },
      required: ['topicId'],
    },
  },
  {
    name: 'gonderimleri_listele',
    description: 'E-posta ile dağıtılan bültenleri listeler: konu başlığı, alıcı sayısı, gönderim durumu ve zamanı.',
    parameters: {
      type: 'object',
      properties: {
        topicId: { type: 'string', description: 'Yalnızca bu konunun gönderimleri. Boş bırakılırsa en yeni gönderimler döner.' },
        limit: { type: 'integer', description: 'En fazla kaç gönderim dönsün (varsayılan 20, en çok 50).' },
      },
    },
  },
  {
    name: 'dagitim_gruplarini_listele',
    description: 'Tanımlı müşteri/dağıtım gruplarını ve her birindeki alıcı sayısını listeler.',
    parameters: { type: 'object', properties: {} },
  },
]

export class UnknownChatToolError extends Error {
  override name = 'UnknownChatToolError'
}

/**
 * Runs one tool call.
 *
 * Arguments arrive from the model, so every one of them is treated as untrusted
 * input: unknown names are refused and limits are clamped here rather than
 * trusted to whatever number the model produced.
 */
export async function runChatTool(
  name: string,
  args: Record<string, unknown>,
  knowledge: AssistantKnowledge,
  context: ChatToolContext = {},
): Promise<unknown> {
  switch (name) {
    case 'rapor_sablonlarini_listele':
      return { sablonlar: context.listTemplates ? (await context.listTemplates()).map((item) => ({ ...item, url: `/templates?id=${item.id}` })) : [] }
    case 'rapor_sablonu_taslagi_olustur': {
      if (!context.authorizedTemplate || !context.createTemplate) throw new UnknownChatToolError('Yeni şablon oluşturma isteği mevcut kullanıcı mesajında açıkça bulunmuyor.')
      const request = requireText(args.istek, 'istek').slice(0, 4_000)
      const preset = args.hazirDuzen === 'detailed' || args.hazirDuzen === 'empty-day' ? args.hazirDuzen : 'executive'
      const created = await context.createTemplate({ request, preset })
      return { templateId: created.id, name: created.name, url: `/templates?id=${created.id}`, status: 'TASLAK' }
    }
    case 'tarihli_tarama_baslat': {
      const targetDate = requireDate(args.tarih, 'tarih')
      if (!context.authorizedRun || targetDate !== context.authorizedRun.targetDate || !context.startRun) {
        throw new UnknownChatToolError('Bu tarih için tarama başlatma isteği mevcut kullanıcı mesajında açıkça bulunmuyor.')
      }
      let run: Awaited<ReturnType<NonNullable<ChatToolContext['startRun']>>>
      try {
        run = await context.startRun({ targetDate, requestKey: context.authorizedRun.requestKey })
      } catch {
        throw new UnknownChatToolError('Tarama başlatılamadı. Lütfen daha sonra yeniden deneyin.')
      }
      return { runId: run.id, targetDate: run.targetDate, status: run.status, runUrl: `/runs/${run.id}`, note: 'Tarama kuyruğa alındı; rapor henüz hazır değil.' }
    }
    case 'eklenen_kaynaklari_ara':
      return { kaynaklar: await knowledge.searchManagedSources({ ...optionalText(args, 'sorgu', 'query'), limit: clamp(args.limit, 10, 25) }) }
    case 'eklenen_kaynagi_getir':
      return await knowledge.getManagedSource({ id: requireText(args.kaynakId, 'kaynakId') }) ?? { bulunamadi: 'Eklenen kaynak bulunamadı.' }
    case 'raporlari_ara':
      return { raporlar: await knowledge.searchReports({
        ...optionalText(args, 'sorgu', 'query'),
        ...optionalDate(args, 'baslangicTarihi', 'from'),
        ...optionalDate(args, 'bitisTarihi', 'to'),
        limit: clamp(args.limit, 10, 25),
      }) }
    case 'rapor_getir': {
      const identity = reportIdentity(args)
      const report = await knowledge.getReport({ ...identity, ...optionalNumber(args, 'surum', 'version') })
      return report ?? { bulunamadi: 'İstenen rapor bulunamadı.' }
    }
    case 'gunluk_raporlari_getir':
      return { taramalar: await knowledge.dailyReports({ date: requireDate(args.tarih, 'tarih') }) }
    case 'rapor_dosyalari_getir':
      return await knowledge.reportFiles({ ...reportIdentity(args), ...optionalNumber(args, 'surum', 'version') }) ?? { bulunamadi: 'Rapor dosyaları bulunamadı.' }
    case 'revizyon_gecmisi_getir':
      return await knowledge.revisionHistory(reportIdentity(args)) ?? { bulunamadi: 'Revizyon geçmişi bulunamadı.' }
    case 'taslak_degisiklikleri_getir':
      return await knowledge.draftChanges(reportIdentity(args)) ?? { bulunamadi: 'Rapor taslağı bulunamadı.' }
    case 'belge_baglantilari_getir':
      return await knowledge.documentConnections({ documentId: requireText(args.belgeId, 'belgeId') }) ?? { bulunamadi: 'Belge bulunamadı.' }
    case 'tarama_adimlari_getir':
      return await knowledge.scanStages({ runId: requireText(args.runId, 'runId') }) ?? { bulunamadi: 'Tarama bulunamadı.' }
    case 'resmi_gazete_ara':
      return await knowledge.searchOfficial({ query: requireText(args.sorgu, 'sorgu'), ...(args.bitisTarihi ? { endDate: requireDate(args.bitisTarihi, 'bitisTarihi') } : {}), limit: clamp(args.limit, 10, 20) })
    case 'resmi_gazete_belge_getir':
      return await knowledge.getOfficialDocument({ sourceUrl: requireText(args.kaynakUrl, 'kaynakUrl'), ...optionalText(args, 'baslik', 'title'), ...optionalDate(args, 'tarih', 'publicationDate') }) ?? { bulunamadi: 'Resmî belge bulunamadı.' }
    case 'analiz_getir': {
      const topicId = requireText(args.topicId, 'topicId')
      const analysis = await knowledge.getAnalysis({ topicId, ...optionalNumber(args, 'surum', 'version') })
      return analysis ?? { bulunamadi: `${topicId} için analiz bulunamadı.` }
    }
    case 'belgeleri_ara':
      return { belgeler: await knowledge.searchDocuments({
        ...optionalText(args, 'sorgu', 'query'),
        ...optionalDate(args, 'baslangicTarihi', 'from'),
        ...optionalDate(args, 'bitisTarihi', 'to'),
        ...(typeof args.sadeceIlgili === 'boolean' ? { onlyRelevant: args.sadeceIlgili } : {}),
        limit: clamp(args.limit, 20, 50),
      }) }
    case 'belge_metni_getir': {
      const documentId = requireText(args.belgeId, 'belgeId')
      const document = await knowledge.getDocumentText({ documentId })
      return document ?? { bulunamadi: `${documentId} kimlikli belge yok.` }
    }
    case 'taramalari_listele':
      return { taramalar: await knowledge.listScanRuns({
        ...optionalDate(args, 'tarih', 'date'),
        limit: clamp(args.limit, 10, 30),
      }) }
    case 'tarama_icerigi_getir': {
      const runId = requireText(args.runId, 'runId')
      return { calisma: await knowledge.getRunContents({ runId }) ?? { bulunamadi: `${runId} kimlikli tarama bulunamadı.` } }
    }
    case 'onceki_kaynaklari_listele':
      return { kaynaklar: await knowledge.listPreviousSources({ topicId: requireText(args.topicId, 'topicId') }) }
    case 'gonderimleri_listele':
      return { gonderimler: await knowledge.listDeliveries({
        ...optionalText(args, 'topicId', 'topicId'),
        limit: clamp(args.limit, 20, 50),
      }) }
    case 'dagitim_gruplarini_listele':
      return { gruplar: await knowledge.listCustomerGroups() }
    default:
      throw new UnknownChatToolError(`Tanımsız araç: ${name}`)
  }
}

function reportIdentity(args: Record<string, unknown>): { topicId?: string; reportId?: string } {
  if (typeof args.reportId === 'string' && args.reportId.trim()) return { reportId: args.reportId.trim() }
  return { topicId: requireText(args.topicId, 'topicId veya reportId') }
}

function requireDate(value: unknown, field: string): string {
  const text = requireText(value, field)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(`${text}T00:00:00.000Z`).getTime()) || new Date(`${text}T00:00:00.000Z`).toISOString().slice(0, 10) !== text) {
    throw new UnknownChatToolError(`${field} gerçek bir YYYY-AA-GG tarihi olmalıdır.`)
  }
  return text
}

function clamp(value: unknown, fallback: number, maximum: number): number {
  const parsed = typeof value === 'number' ? Math.floor(value) : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, maximum)
}

function optionalText<K extends string>(args: Record<string, unknown>, from: string, to: K): Partial<Record<K, string>> {
  const value = args[from]
  return typeof value === 'string' && value.trim().length > 0
    ? ({ [to]: value.trim() } as Record<K, string>)
    : {}
}

function optionalNumber<K extends string>(args: Record<string, unknown>, from: string, to: K): Partial<Record<K, number>> {
  if (args[from] === undefined || args[from] === null) return {}
  const value = args[from]
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isInteger(parsed) || parsed < 1) throw new UnknownChatToolError(`${from} pozitif bir tam sayı olmalıdır.`)
  return { [to]: parsed } as Record<K, number>
}

function optionalDate<K extends string>(args: Record<string, unknown>, from: string, to: K): Partial<Record<K, string>> {
  return args[from] === undefined || args[from] === null || args[from] === '' ? {} : { [to]: requireDate(args[from], from) } as Record<K, string>
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new UnknownChatToolError(`${field} alanı zorunludur.`)
  return value.trim()
}
