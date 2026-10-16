/**
 * MinIO yerleşimi (§4.2). Bütün anahtarlar yalnızca buradan üretilir.
 */
const pad2 = (n: number) => String(n).padStart(2, '0')
const safeExt = (ext: string) => {
  const e = ext.replace(/^\./, '').toLowerCase()
  if (!/^[a-z0-9]{1,8}$/.test(e)) throw new Error(`Geçersiz uzantı: ${ext}`)
  return e
}
const assertSha = (sha: string) => {
  if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error('sha256 hex bekleniyor')
  return sha
}
const assertId = (id: string) => {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error(`Geçersiz kimlik: ${id}`)
  return id
}

export const StorageKeys = {
  /** Ham ve normalize dosyalar; içerik adresli, tekil. */
  documentFile: (sha256: string, ext: string) => `documents/${assertSha(sha256).slice(0, 2)}/${sha256}.${safeExt(ext)}`,
  /** Belge Profili (+ ham AI yanıtı ayrı dosyada). */
  profile: (documentVersionId: string, version: number) => `artifacts/documents/${assertId(documentVersionId)}/profile.v${version}.json`,
  profileRaw: (documentVersionId: string, version: number) => `artifacts/documents/${assertId(documentVersionId)}/profile.v${version}.raw.json`,
  /** capture-manifest.json (§9.2). */
  captureManifest: (documentVersionId: string) => `artifacts/documents/${assertId(documentVersionId)}/capture-manifest.json`,
  tariffSnapshot: (gtip: string, date: string) => `artifacts/tariff/${assertId(gtip)}/${date}.json`,
  topicAnalysis: (topicId: string, revision: number) => `artifacts/topics/${assertId(topicId)}/analysis/r${pad2(revision)}.json`,
  reportFile: (reportId: string, revision: number, file: 'spec.json' | 'report.html' | 'report.pdf') =>
    `artifacts/reports/${assertId(reportId)}/r${pad2(revision)}/${file}`,
  upload: (conversationId: string, uuid: string, ext: string) => `uploads/${assertId(conversationId)}/${assertId(uuid)}.${safeExt(ext)}`,
  sourceFixture: (sourceId: string, version: number, path: string) => {
    if (path.includes('..') || path.startsWith('/')) throw new Error('Geçersiz fixture yolu')
    return `fixtures/sources/${assertId(sourceId)}/v${version}/${path}`
  },
} as const
