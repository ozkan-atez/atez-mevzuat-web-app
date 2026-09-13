import type { CompletedRunSnapshot } from './ports'

export function buildManifest(snapshot: CompletedRunSnapshot): Buffer {
  const objects = [...snapshot.objects].sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl))
  const editions = snapshot.run.editions.map((edition) => ({
    type: edition.type,
    supplementNo: edition.supplementNo,
    documents: edition.documents.map((document) => {
      const object = objects.find((item) => item.documentId === document.id)
      if (!object) throw new Error(`Stored object is missing for document ${document.id}`)
      const decision = snapshot.filterAudit?.decisions.find((item) => item.documentId === document.id)
      return {
        title: document.title,
        sourceUrl: document.sourceUrl,
        objectKey: object.objectKey,
        sha256: object.sha256,
        mediaType: object.mediaType,
        byteSize: object.byteSize.toString(),
        filter: decision && snapshot.filterAudit ? {
          titleDecision: decision.titleDecision,
          titleReason: decision.titleReason,
          titleConfidence: decision.titleConfidence,
          contentDecision: decision.contentDecision,
          contentReason: decision.contentReason,
          contentConfidence: decision.contentConfidence,
          finalDecision: decision.finalDecision,
          model: snapshot.filterAudit.model,
          titlePromptVersion: snapshot.filterAudit.titlePromptVersion,
          contentPromptVersion: snapshot.filterAudit.contentPromptVersion,
          configurationHash: snapshot.filterAudit.configurationHash,
        } : null,
        assets: objects
          .filter((item) => item.parentDocumentId === document.id)
          .map((asset) => ({
            sourceUrl: asset.sourceUrl,
            role: asset.role,
            objectKey: asset.objectKey,
            sha256: asset.sha256,
            mediaType: asset.mediaType,
            byteSize: asset.byteSize.toString(),
          })),
      }
    }),
  }))
  const bytes = objects.reduce((total, object) => total + object.byteSize, 0n)
  const assets = objects.filter((object) => object.assetId)

  return Buffer.from(JSON.stringify({
    schemaVersion: 2,
    runId: snapshot.run.id,
    source: 'RESMI_GAZETE',
    targetDate: snapshot.run.targetDate,
    createdAt: snapshot.run.completedAt ?? snapshot.run.startedAt,
    index: snapshot.index,
    editions,
    filterAudit: snapshot.filterAudit,
    totals: {
      editions: editions.length,
      documents: editions.reduce((total, edition) => total + edition.documents.length, 0),
      assets: assets.length,
      bytes: bytes.toString(),
    },
  }, null, 2))
}
