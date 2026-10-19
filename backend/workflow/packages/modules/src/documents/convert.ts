import { PermanentError, TransientError } from '@atez/platform'

/** DOCX/XLSX → PDF (Gotenberg LibreOffice). Biçim dönüşümüdür, metin çıkarma değil (§6.1). */
export async function convertOfficeToPdf(gotenbergUrl: string, fileName: string, body: Uint8Array): Promise<Buffer> {
  const form = new FormData()
  form.append('files', new Blob([body]), fileName)
  let res: Response
  try {
    res = await fetch(new URL('/forms/libreoffice/convert', gotenbergUrl), { method: 'POST', body: form, signal: AbortSignal.timeout(180_000) })
  } catch (err) {
    throw new TransientError(`Gotenberg erişilemedi: ${String(err)}`, 'GOTENBERG_NETWORK')
  }
  if (res.status >= 500) throw new TransientError(`Gotenberg ${res.status}`, 'GOTENBERG_STATUS')
  if (!res.ok) throw new PermanentError(`Gotenberg dönüştüremedi (${res.status})`, 'GOTENBERG_REJECTED')
  return Buffer.from(await res.arrayBuffer())
}
