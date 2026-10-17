const BY_EXT: Record<string, string> = {
  htm: 'text/html',
  html: 'text/html',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
}
const EXT_BY_MIME = Object.fromEntries(Object.entries(BY_EXT).map(([e, m]) => [m, e]))

export function extOfUrl(url: string): string | null {
  const m = new URL(url).pathname.toLowerCase().match(/\.([a-z0-9]{1,5})$/)
  return m ? m[1]! : null
}

export function sniffMime(url: string, contentType: string | null, body: Buffer): { mime: string; ext: string } {
  if (body.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' }
  const ext = extOfUrl(url)
  if (ext && BY_EXT[ext]) return { mime: BY_EXT[ext]!, ext: ext === 'htm' ? 'html' : ext }
  const ct = contentType?.split(';')[0]?.trim().toLowerCase()
  if (ct && EXT_BY_MIME[ct]) return { mime: ct, ext: EXT_BY_MIME[ct]! }
  return { mime: ct || 'application/octet-stream', ext: 'bin' }
}

/** Gemini'nin yerel okuyabildiği türler (görsel/PDF/HTML-metin). */
export const MODEL_NATIVE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/html'])
export const OFFICE = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])
