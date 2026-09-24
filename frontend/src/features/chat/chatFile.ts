import { MAX_CHAT_FILE_BYTES } from './types'

const types: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html', htm: 'text/html', json: 'application/json',
}

export function chatFileMediaType(file: File): string | null {
  return types[file.name.split('.').at(-1)?.toLowerCase() ?? ''] ?? null
}

export function validateChatFile(file: File): string | null {
  if (!chatFileMediaType(file)) return 'PDF, görsel veya TXT, MD, CSV, JSON, HTML dosyası seçin.'
  if (file.size === 0) return 'Boş dosya eklenemez.'
  if (file.size > MAX_CHAT_FILE_BYTES) return 'Dosya en fazla 5 MB olabilir.'
  return null
}
