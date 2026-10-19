import { PDFDocument } from 'pdf-lib'

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  return doc.getPageCount()
}

export interface PdfPart {
  pageRange: [number, number] // 1 tabanlı, kapalı aralık
  bytes: Uint8Array
}

/**
 * Büyük PDF'i sayfa aralıklarına böler (§6.3, `pdf-lib`; metin çıkarılmaz). Her parça hem
 * sayfa sınırının hem bayt bütçesinin altında kalır; tek sayfa bütçeyi aşarsa yine tek başına
 * bir parça olur (model sınırını sağlayıcı bildirir).
 */
export async function splitPdf(bytes: Uint8Array, opts: { maxBytes: number; maxPages: number }): Promise<PdfPart[]> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const total = src.getPageCount()
  const parts: PdfPart[] = []
  const build = async (from: number, to: number) => {
    const out = await PDFDocument.create()
    const pages = await out.copyPages(src, Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i))
    for (const p of pages) out.addPage(p)
    return out.save({ useObjectStreams: true })
  }
  let start = 1
  // İlk tahmin: ortalama sayfa boyutuna göre, %15 pay bırakarak.
  const estimate = Math.max(1, Math.min(opts.maxPages, Math.floor((total * opts.maxBytes * 0.85) / Math.max(bytes.length, 1))))
  while (start <= total) {
    let size = Math.min(estimate, total - start + 1)
    let built = await build(start, start + size - 1)
    while (built.length > opts.maxBytes && size > 1) {
      size = Math.max(1, Math.floor(size * 0.7))
      built = await build(start, start + size - 1)
    }
    parts.push({ pageRange: [start, start + size - 1], bytes: built })
    start += size
  }
  return parts
}
