import type { FileRef, StepInput, StepOutput } from '@atez/contracts'
import type { StepHandler } from '@atez/engine'
import { StorageKeys, sha256, type AiConfig } from '@atez/platform'
import { MODEL_NATIVE, OFFICE, cleanWordHtml, convertOfficeToPdf, decodeHtml, documents, pdfPageCount, splitPdf, type NewFile } from '@atez/modules'
import { DEFAULT_AI_CONFIG } from '@atez/platform'
import type { StepDeps } from './deps'

const limits = (cfg: AiConfig | undefined) => ({ budget: (cfg ?? DEFAULT_AI_CONFIG).inlineBudgetBytes, maxPages: (cfg ?? DEFAULT_AI_CONFIG).maxPagesPerPart })

/**
 * `doc.normalize`: ORIGINAL → MODEL_INPUT. HTML → temiz UTF-8 HTML; PDF/görsel olduğu gibi;
 * DOCX/XLSX → PDF (Gotenberg); sınırı aşan PDF → sayfa aralığı PART'ları. Metin çıkarılmaz (K11).
 */
export const docNormalize: StepHandler<StepInput<'doc.normalize'>, StepOutput<'doc.normalize'>, StepDeps> = {
  key: 'doc.normalize',
  versions: (ctx) => {
    const l = limits(ctx.deps.ai?.config)
    return { handler: '1', budget: String(l.budget), maxPages: String(l.maxPages) }
  },
  // Dosya kayıtları sürüme bağlı; aynı içerikli iki belge önbelleği paylaşmaz.
  cacheIdentity: (input) => `${input.documentVersionId}:${input.contentHash}`,
  async run(input, ctx) {
    const { db, store } = ctx.deps
    const { budget, maxPages } = limits(ctx.deps.ai?.config)
    const out: NewFile[] = []
    const skipped: { label: string; reason: string }[] = input.failed.map((f, i) => ({ label: `failed${i + 1}`, reason: `${f.reason}: ${f.url}` }))
    const put = async (bytes: Uint8Array, ext: string, mime: string) => {
      const sha = sha256(bytes)
      const key = StorageKeys.documentFile(sha, ext)
      if (!(await store.exists(key))) await store.put(key, bytes, mime)
      return { sha, key }
    }
    const addPdf = async (src: FileRef, bytes: Uint8Array, objectKey: string, sha: string) => {
      const pages = await pdfPageCount(bytes)
      if (bytes.length <= budget && pages <= maxPages) {
        out.push({ role: 'MODEL_INPUT', label: src.label, url: null, mime: 'application/pdf', encoding: null, bytes: bytes.length, sha256: sha, objectKey, pageRange: [1, pages] })
        return
      }
      const parts = await splitPdf(bytes, { maxBytes: budget, maxPages })
      for (const [i, p] of parts.entries()) {
        const stored = await put(p.bytes, 'pdf', 'application/pdf')
        out.push({ role: 'PART', label: `${src.label}#p${i + 1}`, url: null, mime: 'application/pdf', encoding: null, bytes: p.bytes.length, sha256: stored.sha, objectKey: stored.key, pageRange: p.pageRange })
      }
      ctx.log.info('pdf split', { label: src.label, pages, parts: parts.length })
    }

    for (const f of input.files) {
      if (f.mime === 'text/html') {
        const { html } = decodeHtml(await store.get(f.objectKey), null)
        const cleaned = Buffer.from(cleanWordHtml(html), 'utf8')
        const stored = await put(cleaned, 'html', 'text/html')
        out.push({ role: 'MODEL_INPUT', label: f.label, url: null, mime: 'text/html', encoding: 'utf-8', bytes: cleaned.length, sha256: stored.sha, objectKey: stored.key, pageRange: null })
      } else if (f.mime === 'application/pdf') {
        await addPdf(f, await store.get(f.objectKey), f.objectKey, f.sha256)
      } else if (MODEL_NATIVE.has(f.mime)) {
        if (f.bytes > budget) skipped.push({ label: f.label, reason: 'IMAGE_TOO_LARGE' })
        else out.push({ role: 'MODEL_INPUT', label: f.label, url: null, mime: f.mime, encoding: null, bytes: f.bytes, sha256: f.sha256, objectKey: f.objectKey, pageRange: null })
      } else if (OFFICE.has(f.mime)) {
        const gotenberg = process.env.GOTENBERG_URL
        if (!gotenberg) {
          skipped.push({ label: f.label, reason: 'NEEDS_GOTENBERG' })
          continue
        }
        const pdf = await convertOfficeToPdf(gotenberg, `${f.label}.${f.objectKey.split('.').pop()}`, await store.get(f.objectKey))
        const stored = await put(pdf, 'pdf', 'application/pdf')
        await addPdf(f, pdf, stored.key, stored.sha)
      } else {
        skipped.push({ label: f.label, reason: `UNSUPPORTED_TYPE:${f.mime}` })
      }
    }
    const modelInputs = await documents.upsertFiles(db, input.documentVersionId, out)
    return { documentVersionId: input.documentVersionId, contentHash: input.contentHash, modelInputs, skipped }
  },
}
