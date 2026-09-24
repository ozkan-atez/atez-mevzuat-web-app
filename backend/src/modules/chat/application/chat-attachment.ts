import type { ChatAttachmentInput } from './ports'

export const MAX_CHAT_FILE_BYTES = 5_000_000
export const CHAT_FILE_TYPES = [
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
  'text/plain', 'text/markdown', 'text/csv', 'text/html', 'application/json',
] as const

export function decodeChatAttachment(input: { name: string; mediaType: string; data: string }): ChatAttachmentInput {
  const name = input.name.trim().replace(/[\\/]/g, '_')
  if (!name || name.length > 160 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Geçersiz dosya adı.')
  if (!(CHAT_FILE_TYPES as readonly string[]).includes(input.mediaType)) throw new Error('Bu dosya türü desteklenmiyor.')
  if (!input.data || input.data.length > Math.ceil(MAX_CHAT_FILE_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.data)) {
    throw new Error('Dosya boş, çok büyük veya bozuk.')
  }
  const bytes = Buffer.from(input.data, 'base64')
  if (bytes.length === 0 || bytes.length > MAX_CHAT_FILE_BYTES || bytes.toString('base64') !== input.data) throw new Error('Dosya boş, çok büyük veya bozuk.')
  if (input.mediaType === 'application/pdf' && bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Geçersiz PDF dosyası.')
  if (input.mediaType === 'image/png' && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Geçersiz PNG dosyası.')
  if (input.mediaType === 'image/jpeg' && (bytes[0] !== 0xff || bytes[1] !== 0xd8)) throw new Error('Geçersiz JPEG dosyası.')
  if (input.mediaType === 'image/webp' && (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP')) throw new Error('Geçersiz WebP dosyası.')
  if (input.mediaType.startsWith('text/') || input.mediaType === 'application/json') {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error('Metin dosyası UTF-8 biçiminde olmalıdır.') }
  }
  return { name, mediaType: input.mediaType, bytes }
}
