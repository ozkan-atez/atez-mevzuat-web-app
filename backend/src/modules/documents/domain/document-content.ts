import { extname } from 'node:path'
import { fileTypeFromBuffer } from 'file-type'

export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024
export const DOCUMENT_MAX_TEXT = 1_000_000
export const EXTRACTOR_VERSION = 'atez-local-2'
export class DocumentError extends Error {
  constructor(message: string, readonly statusCode = 422) { super(message) }
}
const supported = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv', 'text/html'])
const extensions: Record<string, string> = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.txt': 'text/plain', '.csv': 'text/csv', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
export async function validateDocumentContent(bytes: Buffer, filename: string, declaredType = '', allowHtml = false): Promise<string> {
  if (!bytes.length) throw new DocumentError('Boş belge eklenemez.')
  if (bytes.length > DOCUMENT_MAX_BYTES) throw new DocumentError('Dosya 20 MB sınırını aşıyor.', 413)
  const expected = extensions[extname(filename).toLowerCase()]
  let detected: string | undefined
  try { detected = (await fileTypeFromBuffer(bytes))?.mime } catch { throw new DocumentError('Dosya içeriği doğrulanamadı.') }
  let mediaType = detected
  if (!mediaType) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new DocumentError('Dosya UTF-8 metin veya desteklenen bir belge olmalıdır.') }
    if (bytes.includes(0)) throw new DocumentError('İkili içerik metin dosyası olarak eklenemez.')
    const declared = declaredType.split(';')[0]!.trim().toLowerCase()
    const html = /^\s*(?:<!doctype\s+html|<html\b)/i.test(bytes.subarray(0, 1024).toString()) || declared === 'text/html'
    if (html && !allowHtml) throw new DocumentError('HTML dosyası yüklemek desteklenmiyor; bağlantı ekleyin.')
    mediaType = html ? 'text/html' : expected === 'text/csv' || declared === 'text/csv' ? 'text/csv' : 'text/plain'
  }
  if (!supported.has(mediaType)) throw new DocumentError('Bu dosya türü desteklenmiyor. PDF, DOCX, XLSX, CSV, TXT veya PNG/JPEG/WebP kullanın.')
  if (expected && mediaType !== expected) throw new DocumentError('Dosya uzantısı içerik türüyle uyuşmuyor.')
  if (mediaType.includes('openxmlformats')) assertOfficeArchive(bytes)
  return mediaType
}
/** Inspect the central directory before any Office decompression. Encrypted/ZIP64 archives fail closed. */
export function assertOfficeArchive(bytes: Buffer): void {
  let end = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { end = offset; break }
  }
  if (end < 0) throw new DocumentError('Office dosyası bozuk.')
  const count = bytes.readUInt16LE(end + 10)
  let position = bytes.readUInt32LE(end + 16)
  if (count === 65535 || position === 0xffffffff || count > 5000 || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) throw new DocumentError('Office arşiv sınırı aşıldı.')
  let total = 0
  for (let index = 0; index < count; index++) {
    if (position + 46 > bytes.length || bytes.readUInt32LE(position) !== 0x02014b50) throw new DocumentError('Office dosyası bozuk.')
    const flags = bytes.readUInt16LE(position + 8)
    const compressed = bytes.readUInt32LE(position + 20)
    const expanded = bytes.readUInt32LE(position + 24)
    if ((flags & 1) || expanded === 0xffffffff || expanded > 40_000_000 || (expanded > 1_000_000 && expanded > Math.max(compressed, 1) * 200)) throw new DocumentError('Office dosyası şifreli veya sıkıştırma sınırını aşıyor.')
    total += expanded
    if (total > 80_000_000) throw new DocumentError('Office açılmış içerik sınırı aşıldı.')
    position += 46 + bytes.readUInt16LE(position + 28) + bytes.readUInt16LE(position + 30) + bytes.readUInt16LE(position + 32)
  }
}
