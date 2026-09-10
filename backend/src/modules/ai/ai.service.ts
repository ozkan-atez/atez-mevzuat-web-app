import { z } from 'zod'

// Dokümanda (Bölüm 9) belirtilen tek gerçek içerik modeli
export const ReportContentSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string(),
  sectors: z.array(z.string()),
  blocks: z.array(z.object({
    id: z.string(),
    type: z.enum(['summary', 'change', 'table', 'action', 'notice']),
    text: z.string().optional(),
    before: z.string().nullable().optional(),
    after: z.string().optional(),
    evidence: z.array(z.object({ evidenceId: z.string() }))
  }))
})

export type ReportContent = z.infer<typeof ReportContentSchema>

/**
 * Bu servis gerçek hayatta Google Gemini SDK'sını kullanır.
 * Mevcut aşamada "Structured Output" (Yapılandırılmış JSON Çıktısı)
 * mantığını Zod şeması ile simüle ediyoruz.
 */
export async function analyzeDocument(documentText: string): Promise<ReportContent> {
  console.log(`[AI] Belge analiz ediliyor... (Uzunluk: ${documentText.length} karakter)`)
  
  // AI İstek Gecikmesi Simülasyonu
  await new Promise(resolve => setTimeout(resolve, 1500))

  // Gemini'nin "responseSchema" ayarıyla döneceği varsayılan yapılandırılmış JSON
  const mockAiResponse = {
    schemaVersion: 1,
    title: "Kurumlar Vergisi Genel Tebliği (Seri No: 23)",
    sectors: ["Finans", "Muhasebe"],
    blocks: [
      {
        id: "b-001",
        type: "summary",
        text: "Kurumlar vergisi oranlarında %25'e varan değişiklikler yapılmıştır.",
        evidence: [{ evidenceId: "doc-v1-paragraph-3" }]
      }
    ]
  }

  // Modelden dönen veriyi sisteme almadan önce Zod ile %100 uyumluluğunu (Strict Schema) test ediyoruz.
  // Uyumsuz bir JSON dönerse burada Exception fırlatır ve sistem arızalı veri kaydetmez.
  return ReportContentSchema.parse(mockAiResponse)
}
