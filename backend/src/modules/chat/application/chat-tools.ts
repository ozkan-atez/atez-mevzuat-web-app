import type { AssistantKnowledge } from './assistant-knowledge'

export interface ChatToolDeclaration {
  name: string
  description: string
  parameters: Record<string, unknown>
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
    description: 'Bir mevzuat konusunun bülten içeriğini tam metin olarak getirir: başlık, özet, etkilenen taraflar, yürürlük tarihleri, varsa tablo ve notlar. topicId değerini önce raporlari_ara ile bulun.',
    parameters: {
      type: 'object',
      properties: {
        topicId: { type: 'string', description: 'Raporun ait olduğu konunun kimliği (UUID).' },
        surum: { type: 'integer', description: 'İstenen revizyon numarası; boş bırakılırsa en güncel revizyon döner.' },
      },
      required: ['topicId'],
    },
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
): Promise<unknown> {
  switch (name) {
    case 'raporlari_ara':
      return { raporlar: await knowledge.searchReports({
        ...optionalText(args, 'sorgu', 'query'),
        ...optionalText(args, 'baslangicTarihi', 'from'),
        ...optionalText(args, 'bitisTarihi', 'to'),
        limit: clamp(args.limit, 10, 25),
      }) }
    case 'rapor_getir': {
      const topicId = requireText(args.topicId, 'topicId')
      const report = await knowledge.getReport({ topicId, ...optionalNumber(args, 'surum', 'version') })
      return report ?? { bulunamadi: `${topicId} için yayımlanmış rapor yok.` }
    }
    case 'analiz_getir': {
      const topicId = requireText(args.topicId, 'topicId')
      const analysis = await knowledge.getAnalysis({ topicId, ...optionalNumber(args, 'surum', 'version') })
      return analysis ?? { bulunamadi: `${topicId} için analiz bulunamadı.` }
    }
    case 'belgeleri_ara':
      return { belgeler: await knowledge.searchDocuments({
        ...optionalText(args, 'sorgu', 'query'),
        ...optionalText(args, 'baslangicTarihi', 'from'),
        ...optionalText(args, 'bitisTarihi', 'to'),
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
        ...optionalText(args, 'tarih', 'date'),
        limit: clamp(args.limit, 10, 30),
      }) }
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
  const value = args[from]
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? ({ [to]: parsed } as Record<K, number>) : {}
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new UnknownChatToolError(`${field} alanı zorunludur.`)
  return value.trim()
}
