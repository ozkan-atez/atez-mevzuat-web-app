import { open } from 'node:fs/promises'
import { fileTypeFromFile } from 'file-type'

const supportedImages = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp'])

export async function detectAndValidate(
  path: string,
  declaredType: string | null,
  sourceUrl: string,
): Promise<{ mediaType: string }> {
  const prefix = await readPrefix(path, 512)
  const lower = prefix.toString('utf8').trimStart().toLowerCase()
  const expectedPdf = new URL(sourceUrl).pathname.toLowerCase().endsWith('.pdf') || declaredType?.includes('application/pdf')

  if (expectedPdf) {
    if (!prefix.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new Error('PDF signature is missing')
    }
    return { mediaType: 'application/pdf' }
  }

  if (lower.startsWith('<!doctype html') || lower.startsWith('<html') || lower.includes('<html')) {
    return { mediaType: 'text/html' }
  }

  const detected = await fileTypeFromFile(path)
  if (detected && supportedImages.has(detected.mime)) {
    return { mediaType: detected.mime }
  }

  throw new Error(`Unsupported or invalid file content: ${sourceUrl}`)
}

async function readPrefix(path: string, length: number): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}
