import type { StepInput, StepOutput } from '@atez/contracts'
import type { StepHandler } from '@atez/engine'
import { PermanentError, StorageKeys, TransientError, sha256 } from '@atez/platform'
import { assetLinks, decodeHtml, documents, emptyHints, extractHints, loadSourceDefinition, sniffMime, visibleText, type NewFileInput } from '@atez/modules'
import type { StepDeps } from './deps'

/**
 * `doc.fetch` (§5.3 basamak 2): koşullu istek (If-None-Match / If-Modified-Since). 304 ya da
 * aynı içerik hash'i → yeni sürüm açılmaz (SAME). Ham dosyalar içerik adresli olarak MinIO'ya;
 * `capture-manifest.json` (§9.2) kodla çıkarılmış ipuçlarıyla yazılır.
 */
export const docFetch: StepHandler<StepInput<'doc.fetch'>, StepOutput<'doc.fetch'>, StepDeps> = {
  key: 'doc.fetch',
  versions: () => ({ handler: '1' }),
  cacheIdentity: () => null,
  async run(input, ctx) {
    const { db, store, http } = ctx.deps
    const doc = await documents.getDocument(db, input.candidate.documentId)
    if (!doc) throw new PermanentError('Belge kaydı yok', 'DOCUMENT_MISSING')
    const def = loadSourceDefinition(ctx.deps.configDir, doc.sourceId)
    const latest = doc.latestVersionId ? await documents.getVersion(db, doc.latestVersionId) : null

    const res = await http.fetch({ url: doc.url, etag: !ctx.force && latest ? doc.etag : null, lastModified: !ctx.force && latest ? doc.lastModified : null })
    if (res.notModified && latest) {
      const files = await documents.filesOf(db, latest.id, ['ORIGINAL', 'ATTACHMENT'])
      await documents.setDocumentState(db, doc.id, doc.processingState === 'PROFILED' ? 'PROFILED' : 'FETCHED')
      return { documentId: doc.id, documentVersionId: latest.id, contentHash: latest.contentHash, delta: 'SAME', files, manifestKey: latest.manifestKey ?? '', failed: [] }
    }
    if (res.status === 404 || res.status === 410) throw new PermanentError(`Belge bulunamadı (HTTP ${res.status})`, 'NOT_FOUND')
    if (res.status !== 200) throw new TransientError(`HTTP ${res.status}`, 'HTTP_STATUS')

    const main = sniffMime(doc.url, res.headers.contentType, res.body)
    if (doc.url.toLowerCase().endsWith('.pdf') && main.mime !== 'application/pdf') {
      throw new PermanentError('PDF beklenirken başka içerik döndü (soft-404?)', 'SOFT_ERROR')
    }
    const files: NewFileInput[] = []
    const mainSha = sha256(res.body)
    const mainKey = StorageKeys.documentFile(mainSha, main.ext)
    if (!(await store.exists(mainKey))) await store.put(mainKey, res.body, main.mime)
    let encoding: string | null = null
    let hints = emptyHints()
    const failed: { url: string; reason: string }[] = []
    const skippedLinks: { url: string; reason: string }[] = []
    files.push({ role: 'ORIGINAL', label: 'f1', url: doc.url, mime: main.mime, encoding: null, bytes: res.body.length, sha256: mainSha, objectKey: mainKey, pageRange: null })

    if (main.mime === 'text/html') {
      const decoded = decodeHtml(res.body, res.headers.contentType)
      encoding = decoded.encoding
      files[0]!.encoding = encoding
      hints = extractHints(`${visibleText(decoded.html)}\n${decoded.html.match(/https?:\/\/[^\s"'<>]+/g)?.join('\n') ?? ''}`, doc.title)
      const { assets, skipped } = assetLinks(decoded.html, doc.url, def.fetch.allowedHosts)
      skippedLinks.push(...skipped)
      for (const [i, a] of assets.slice(0, def.fetch.maxAttachmentsPerDocument).entries()) {
        const r = await http.fetch({ url: a.url })
        if (r.status !== 200) {
          failed.push({ url: a.url, reason: `HTTP ${r.status}` })
          continue
        }
        const m = sniffMime(a.url, r.headers.contentType, r.body)
        const sha = sha256(r.body)
        const key = StorageKeys.documentFile(sha, m.ext)
        if (!(await store.exists(key))) await store.put(key, r.body, m.mime)
        files.push({ role: 'ATTACHMENT', label: `f${i + 2}`, url: a.url, mime: m.mime, encoding: null, bytes: r.body.length, sha256: sha, objectKey: key, pageRange: null })
      }
      for (const a of assets.slice(def.fetch.maxAttachmentsPerDocument)) failed.push({ url: a.url, reason: 'ATTACHMENT_LIMIT' })
    }

    const contentHash = `sha256:${sha256(files.map((f) => `${f.label}:${f.sha256}`).join('|'))}`
    const existing = await documents.findVersion(db, doc.id, contentHash)
    const delta = existing ? 'SAME' : latest ? 'CHANGED' : 'NEW'

    const { version, refs } = await db.transaction(async (tx) => {
      const version = existing ?? (await documents.createVersion(tx, doc.id, contentHash, null))
      const refs = await documents.upsertFiles(tx, version.id, files)
      return { version, refs }
    })
    const manifestKey = StorageKeys.captureManifest(version.id)
    const manifest = {
      schemaVersion: 1,
      documentVersionId: version.id,
      contentHash,
      publishedOn: { value: doc.publishedOn, from: 'LIST', raw: null },
      files: files.map((f) => ({ role: f.role === 'ORIGINAL' ? 'MAIN' : f.role, url: f.url, mime: f.mime, encoding: f.encoding, bytes: f.bytes, sha256: f.sha256, objectKey: f.objectKey, pages: null })),
      skippedLinks,
      hints,
      coverage: { expectedFiles: files.length + failed.length, capturedFiles: files.length, failed },
      access: { httpStatus: res.status, softError: false, robots: 'ALLOWED', loginUsed: false },
    }
    await store.put(manifestKey, JSON.stringify(manifest, null, 2), 'application/json')
    await db.transaction(async (tx) => {
      await documents.createVersion(tx, doc.id, contentHash, manifestKey)
      await documents.setDocumentState(tx, doc.id, delta === 'SAME' && doc.processingState === 'PROFILED' ? 'PROFILED' : 'FETCHED', {
        latestVersionId: version.id,
        etag: res.headers.etag,
        lastModified: res.headers.lastModified,
      })
    })
    ctx.log.info('doc fetched', { documentId: doc.id, delta, files: files.length, failed: failed.length })
    return { documentId: doc.id, documentVersionId: version.id, contentHash, delta, files: refs, manifestKey, failed }
  },
}
