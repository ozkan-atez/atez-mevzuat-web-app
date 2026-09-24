import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

/** Bounded extraction for the assistant; scanned/image-only pages remain unreadable. */
export async function extractPdfText(bytes: Buffer, maxPages = 20, maxCharacters = 20_000): Promise<string | null> {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
  try {
    const pdf = await task.promise
    const pages: string[] = []
    for (let index = 1; index <= Math.min(pdf.numPages, maxPages); index += 1) {
      const page = await pdf.getPage(index)
      const content = await page.getTextContent()
      pages.push(content.items.flatMap((item) => 'str' in item ? [item.str] : []).join(' '))
      if (pages.join('\n').length >= maxCharacters) break
    }
    const text = pages.join('\n').replace(/\s+/g, ' ').trim()
    if (!isReadablePdfText(text)) return null
    return `${text.slice(0, maxCharacters)}${text.length > maxCharacters || pdf.numPages > maxPages ? '\n(metin kısaltıldı)' : ''}`
  } finally {
    await task.destroy()
  }
}

export function isReadablePdfText(text: string): boolean {
  if (!text.trim()) return false
  // A broken PDF font map can yield hundreds of control characters while
  // pdfjs still reports a nonempty text layer. Never present that as prose.
  const controls = [...text].filter((char) => /[\u0000-\u001f\u007f]/.test(char)).length
  return controls / text.length < 0.02
}
