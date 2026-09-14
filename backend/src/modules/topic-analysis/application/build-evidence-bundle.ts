import { createHash } from 'node:crypto'
import type { AiInputPart } from '../../ai/application/ai-model-client'
import { normalizeDocumentContent } from '../../scan-runs/application/normalize-document-content'
import type { EvidenceContext, EvidencePart, TopicEvidenceInput, TopicObjectStore, TopicStoredObject } from './ports'

interface Candidate {
  sourceId: string
  title: string
  sourceUrl: string
  object: TopicStoredObject
}

export async function buildEvidenceBundle(
  topic: TopicEvidenceInput,
  objectStore: TopicObjectStore,
  options: { maxContextBytes: number },
): Promise<EvidenceContext> {
  const candidates: Candidate[] = [
    { sourceId: 'current-document', title: topic.document.title, sourceUrl: topic.document.sourceUrl, object: topic.document.object },
    ...topic.document.assets.map((asset) => ({ sourceId: `current-asset:${asset.id}`, title: asset.sourceUrl, sourceUrl: asset.sourceUrl, object: asset.object })),
    ...(topic.previousSource ? [
      { sourceId: 'previous-document', title: topic.previousSource.title, sourceUrl: topic.previousSource.sourceUrl, object: topic.previousSource.object },
      ...topic.previousSource.assets.map((asset) => ({ sourceId: `previous-asset:${asset.id}`, title: asset.sourceUrl, sourceUrl: asset.sourceUrl, object: asset.object })),
    ] : []),
  ]

  const totalBytes = candidates.reduce((total, candidate) => total + candidate.object.byteSize, 0n)
  if (totalBytes > BigInt(options.maxContextBytes)) {
    throw new Error(`Topic kanıt paketi Gemini bağlam sınırını aşıyor: ${totalBytes} > ${options.maxContextBytes}`)
  }

  const parts: EvidencePart[] = []
  const aiParts: AiInputPart[] = []
  for (const candidate of candidates) {
    const bytes = await objectStore.getContent(candidate.object.objectKey)
    parts.push({
      topicId: topic.topicId,
      sourceId: candidate.sourceId,
      title: candidate.title,
      sourceUrl: candidate.sourceUrl,
      objectKey: candidate.object.objectKey,
      sha256: candidate.object.sha256,
      mediaType: candidate.object.mediaType,
      byteSize: candidate.object.byteSize.toString(),
    })
    aiParts.push({ text: `Kanıt kimliği: ${candidate.sourceId}\nKaynak URL: ${candidate.sourceUrl}` })
    aiParts.push(...toAiParts(candidate, bytes))
  }

  const manifestValue = {
    schemaVersion: 1,
    topicId: topic.topicId,
    runId: topic.runId,
    targetDate: topic.targetDate,
    parts,
  }
  const manifest = Buffer.from(JSON.stringify(manifestValue))
  const signature = createHash('sha256').update(manifest).digest('hex')
  return { topicId: topic.topicId, signature, parts, aiParts, manifest }
}

function toAiParts(candidate: Candidate, bytes: Buffer): AiInputPart[] {
  if (candidate.object.mediaType.startsWith('image/')) {
    return [{ inlineData: { mimeType: candidate.object.mediaType, data: bytes.toString('base64') } }]
  }
  return normalizeDocumentContent({
    id: candidate.sourceId,
    title: candidate.title,
    mediaType: candidate.object.mediaType,
    bytes,
  })
}
