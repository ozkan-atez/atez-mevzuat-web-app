import { documentAccessWhere } from '../../../platform/actor-context'
import mammoth from 'mammoth'
import ExcelJS from 'exceljs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { load } from 'cheerio'
import type { PrismaClient, Prisma } from '@prisma/client'
import type { ObjectStore } from '../../scan-runs/application/ports'
import { isReadablePdfText } from '../../managed-sources/pdf-text'
import { assertOfficeArchive, DOCUMENT_MAX_BYTES, DOCUMENT_MAX_TEXT, DocumentError, EXTRACTOR_VERSION } from '../domain/document-content'

export interface ExtractedDocument { status: 'READY' | 'OCR_REQUIRED' | 'FAILED'; text: string | null; metadata: { sections: Array<{ reference: string; text: string }>; error?: string; [key:string]: Prisma.JsonValue | undefined } }
function bounded(sections: Array<{ reference: string; text: string }>): ExtractedDocument {
  const text = sections.map(item => item.text).join('\n')
  if (text.length > DOCUMENT_MAX_TEXT) throw new DocumentError('Çıkarılan metin sınırı aşıldı; belgeyi bölümlere ayırın.')
  return { status: text.trim() ? 'READY' : 'OCR_REQUIRED', text: text.trim() || null, metadata: { sections } }
}
export async function extractDocumentBytes(bytes: Buffer, mediaType: string): Promise<ExtractedDocument> {
  if (bytes.length > DOCUMENT_MAX_BYTES) throw new DocumentError('Dosya çıkarma boyut sınırını aşıyor.')
  if (mediaType.startsWith('image/')) return { status: 'OCR_REQUIRED', text: null, metadata: { sections: [], error: 'Görsel için OCR sağlayıcısı gerekiyor.' } }
  if (mediaType === 'application/pdf') {
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true })
    try {
      const pdf = await task.promise
      if (pdf.numPages > 500) throw new DocumentError('PDF 500 sayfa sınırını aşıyor; belgeyi bölümlere ayırın.')
      const sections: Array<{reference: string; text: string}> = []
      let size = 0
      for (let index = 1; index <= pdf.numPages; index++) {
        const page = await pdf.getPage(index)
        const content = await page.getTextContent()
        const text = content.items.flatMap(item => 'str' in item ? [item.str] : []).join(' ')
        if (!isReadablePdfText(text)) continue
        size += text.length
        if (size > DOCUMENT_MAX_TEXT) throw new DocumentError('PDF metin sınırını aşıyor; belgeyi bölümlere ayırın.')
        sections.push({ reference: `page:${index}`, text })
      }
      return bounded(sections)
    } finally { await task.destroy() }
  }
  if (mediaType.includes('wordprocessingml')) {
    assertOfficeArchive(bytes)
    const output = await mammoth.extractRawText({ buffer: bytes })
    return bounded(output.value.split(/\n\s*\n/).filter(Boolean).map((text, i) => ({ reference: `paragraph:${i + 1}`, text })))
  }
  if (mediaType.includes('spreadsheetml')) {
    assertOfficeArchive(bytes)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes as never)
    const sections: Array<{reference: string; text: string}> = []
    let size = 0
    workbook.eachSheet(sheet => sheet.eachRow((row, index) => {
      const cells: string[] = []
      row.eachCell(cell => cells.push(`${cell.address}: ${cell.text}`))
      const text = cells.join(' | ')
      size += text.length
      if (size > DOCUMENT_MAX_TEXT) throw new DocumentError('Çalışma kitabı metin sınırını aşıyor.')
      sections.push({reference: `${sheet.name}!row:${index}`, text})
    }))
    return bounded(sections)
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (mediaType === 'application/json') {
    let data: unknown
    try {data=JSON.parse(text)} catch {throw new DocumentError('Arşivlenmiş JSON belgesi geçerli değil.')}
    return bounded([{reference:'json',text:JSON.stringify(data,null,2)}])
  }
  if (mediaType === 'text/html') {
    const $ = load(text); $('script,style,nav,header,footer,noscript,iframe,object').remove()
    return bounded([{ reference: 'body', text: $('body').text().trim() }])
  }
  if (mediaType === 'text/csv') return bounded(text.split(/\r?\n/).map((line, i) => ({ reference: `row:${i + 1}`, text: line })))
  if (mediaType === 'text/plain') return bounded([{ reference: 'text', text }])
  throw new DocumentError('Bu içerik için metin çıkarıcı yok.')
}
/** Extraction refreshes only its own fields; source classification comes from the server's archive record. */
export function mergeExtractionMetadata(previous:unknown,current:ExtractedDocument['metadata']):ExtractedDocument['metadata'] {
  const preserved = previous && typeof previous==='object' && !Array.isArray(previous) ? {...previous as Record<string,Prisma.JsonValue>} : {}
  delete preserved.sections
  delete preserved.error
  return {...preserved,...current}
}
export async function extractDocumentVersion(dependencies: {prisma: PrismaClient; objectStore: Pick<ObjectStore, 'getContent'>}, versionId: string, actorScope: string) {
  const version = await dependencies.prisma.documentVersion.findFirst({where: {id: versionId, document: documentAccessWhere(actorScope)}, include: {storedObject: true}})
  if (!version) throw new DocumentError('Belge sürümü bulunamadı.', 404)
  let result: ExtractedDocument
  try {
    if (!version.storedObject) throw new DocumentError('Belgenin özgün dosyası arşivde bulunamadı.')
    result = await extractDocumentBytes(await dependencies.objectStore.getContent(version.storedObject.objectKey), version.mimeType)
  } catch (error) {
    result = {status: 'FAILED', text: null, metadata: {sections: [], error: error instanceof DocumentError ? error.message : 'Belge okunamadı; bozuk veya şifreli olabilir.'}}
  }
  result.metadata=mergeExtractionMetadata(version.extractionMetadata,result.metadata)
  await dependencies.prisma.documentVersion.update({where: {id: version.id}, data: {extractedText: result.text, extractionStatus: result.status, extractorVersion: EXTRACTOR_VERSION, extractionMetadata: result.metadata}})
  return result
}
export async function readableDocumentVersions(prisma: PrismaClient, ids: string[], actorScope = 'local-workspace') {
  if (ids.length > 10 || new Set(ids).size !== ids.length) throw new DocumentError('En fazla 10 farklı belge sürümü seçin.', 400)
  const versions = await prisma.documentVersion.findMany({where: {id: {in: ids}, document: documentAccessWhere(actorScope)}, include: {document: true}})
  if (versions.length !== ids.length) throw new DocumentError('Seçilen belge sürümlerinden biri bulunamadı.', 404)
  return ids.map(id => versions.find(version => version.id === id)!)
}
